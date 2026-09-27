import {
  type PublicErrorCode,
  publicProjectKeySchema,
  ticketSubmissionRequestSchema,
} from "@ai-support-platform/support-contracts";
import {
  type IngestionRepository,
  normalizeRequestOrigin,
  resolveProjectOrigin,
  submitSupportRequest,
} from "./support-ingestion";

const MAX_BODY_BYTES = 16 * 1024;

function headers(origin?: string | null) {
  const result = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  if (origin) result.set("Access-Control-Allow-Origin", origin);
  return result;
}

function errorResponse(
  code: PublicErrorCode,
  status: number,
  origin?: string | null,
) {
  return Response.json(
    { error: { code } },
    { status, headers: headers(origin) },
  );
}

async function readLimitedJson(
  request: Request,
): Promise<unknown | "too_large" | "malformed"> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return "too_large";
  if (!request.body) return "malformed";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return "too_large";
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return "malformed";
  } finally {
    reader.releaseLock();
  }
}

function keyFromUnknown(value: unknown) {
  if (typeof value !== "object" || value === null || !("projectKey" in value))
    return undefined;
  const parsed = publicProjectKeySchema.safeParse(value.projectKey);
  return parsed.success ? parsed.data : undefined;
}

export async function handleTicketPost(
  request: Request,
  repository: IngestionRepository,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  ) {
    return errorResponse("UNSUPPORTED_MEDIA_TYPE", 415);
  }
  const body = await readLimitedJson(request);
  if (body === "too_large") return errorResponse("BODY_TOO_LARGE", 413);
  if (body === "malformed") return errorResponse("INVALID_REQUEST", 400);
  const projectKey = keyFromUnknown(body);
  if (!projectKey) return errorResponse("INVALID_REQUEST", 400);
  try {
    const resolved = await resolveProjectOrigin(
      repository,
      projectKey,
      request.headers.get("origin"),
    );
    if (!resolved.ok) {
      console.info(
        JSON.stringify({
          event: "support_rejected",
          requestId,
          code: resolved.code,
        }),
      );
      return errorResponse(
        resolved.code,
        resolved.code === "PROJECT_NOT_FOUND" ? 404 : 403,
      );
    }
    const corsOrigin = resolved.origin;
    const queryKey = new URL(request.url).searchParams.get("projectKey");
    if (queryKey && queryKey !== projectKey)
      return errorResponse("INVALID_REQUEST", 400, corsOrigin);
    const parsed = ticketSubmissionRequestSchema.safeParse(body);
    if (!parsed.success)
      return errorResponse("INVALID_REQUEST", 400, corsOrigin);
    const result = await submitSupportRequest(
      repository,
      parsed.data,
      resolved.project.id,
    );
    if (!result.ok) {
      const status = result.code === "RATE_LIMITED" ? 429 : 409;
      return errorResponse(result.code, status, corsOrigin);
    }
    console.info(
      JSON.stringify({
        event: "support_accepted",
        requestId,
        projectId: resolved.project.id,
      }),
    );
    return Response.json(
      { ticketReference: result.ticketReference, status: "received" },
      { status: 201, headers: headers(corsOrigin) },
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "support_failed",
        requestId,
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
    return errorResponse("SUBMISSION_FAILED", 503);
  }
}

export async function handleTicketOptions(
  request: Request,
  repository: IngestionRepository,
): Promise<Response> {
  const key = publicProjectKeySchema.safeParse(
    new URL(request.url).searchParams.get("projectKey"),
  );
  if (!key.success) return errorResponse("INVALID_REQUEST", 400);
  const origin = request.headers.get("origin");
  if (normalizeRequestOrigin(origin) === "invalid" || origin === null)
    return errorResponse("ORIGIN_NOT_ALLOWED", 403);
  try {
    const resolved = await resolveProjectOrigin(repository, key.data, origin);
    if (!resolved.ok)
      return errorResponse(
        resolved.code,
        resolved.code === "PROJECT_NOT_FOUND" ? 404 : 403,
      );
    const responseHeaders = headers(resolved.origin);
    responseHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "Content-Type");
    responseHeaders.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers: responseHeaders });
  } catch {
    return errorResponse("SUBMISSION_FAILED", 503);
  }
}
