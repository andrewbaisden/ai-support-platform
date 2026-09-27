import {
  type PublicErrorCode,
  publicErrorResponseSchema,
  ticketSubmissionResponseSchema,
} from "@ai-support-platform/support-contracts";
import type { SupportSubmissionClient } from "./types";

export type HttpSubmissionErrorCode =
  | PublicErrorCode
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE";

export class HttpSubmissionError extends Error {
  constructor(public readonly code: HttpSubmissionErrorCode) {
    super("Support request could not be submitted");
  }
}

export class HttpSupportSubmissionClient implements SupportSubmissionClient {
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: {
    apiBaseUrl: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  }) {
    const url = new URL(options.apiBaseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("API URL must use HTTP or HTTPS");
    this.apiBaseUrl = url.href.endsWith("/") ? url.href : `${url.href}/`;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    // Stored, never called as a method: native fetch throws
    // "Illegal invocation" when its receiver is not a Window/global.
    this.fetchImpl = options.fetchImpl;
  }

  async submit(input: Parameters<SupportSubmissionClient["submit"]>[0]) {
    const url = new URL("api/v1/support/tickets", this.apiBaseUrl);
    url.searchParams.set("projectKey", input.projectKey);
    // Bare call on purpose so the receiver stays undefined.
    const fetchImpl = this.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectKey: input.projectKey,
          category: input.category,
          message: input.message,
          contact:
            input.name || input.email
              ? { name: input.name, email: input.email }
              : undefined,
          submissionId: input.idempotencyKey,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new HttpSubmissionError(
        error instanceof Error && error.name === "TimeoutError"
          ? "TIMEOUT"
          : "NETWORK_ERROR",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new HttpSubmissionError("INVALID_RESPONSE");
    }
    if (!response.ok) {
      const parsed = publicErrorResponseSchema.safeParse(body);
      throw new HttpSubmissionError(
        parsed.success ? parsed.data.error.code : "INVALID_RESPONSE",
      );
    }
    const parsed = ticketSubmissionResponseSchema.safeParse(body);
    if (!parsed.success) throw new HttpSubmissionError("INVALID_RESPONSE");
    return { reference: parsed.data.ticketReference };
  }
}
