import { createHash, timingSafeEqual } from "node:crypto";
import {
  BootstrapError,
  type BootstrapInput,
  type BootstrapResult,
  bootstrapInstallation,
  createBootstrapPorts,
  MIN_OWNER_PASSWORD_LENGTH,
  resolveAuthBaseUrl,
} from "@ai-support-platform/auth";
import { z } from "zod";
import { isSameOrigin } from "./dashboard-api";

export interface SetupDependencies {
  setupToken: string | undefined;
  countUsers(): Promise<number>;
  bootstrap(input: BootstrapInput): Promise<BootstrapResult>;
}

export const setupBodySchema = z.strictObject({
  token: z.string().min(1).max(512),
  ownerName: z.string().trim().min(1).max(120),
  ownerEmail: z.email().max(320),
  ownerPassword: z.string().min(MIN_OWNER_PASSWORD_LENGTH).max(256),
  workspaceName: z.string().trim().min(1).max(120),
  projectName: z.string().trim().min(1).max(120),
  allowedOrigins: z.array(z.string().trim().min(1)).min(1).max(20),
});

/** Constant-time comparison that also hides the token's length. */
export function tokensMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** First-run setup is open only on a fresh installation with a token set. */
export async function setupAvailable(deps: SetupDependencies) {
  return Boolean(deps.setupToken) && (await deps.countUsers()) === 0;
}

function reply(body: object, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Create the first owner, workspace, and project. Closed (404) once any
 * account exists or when SETUP_TOKEN is unset, so a fresh deployment cannot
 * be claimed by whoever finds it first.
 */
export async function handleSetupPost(
  request: Request,
  deps: SetupDependencies,
): Promise<Response> {
  if (!(await setupAvailable(deps)) || !deps.setupToken) {
    return reply({ ok: false, error: "SETUP_UNAVAILABLE" }, 404);
  }
  if (!isSameOrigin(request)) {
    return reply({ ok: false, error: "FORBIDDEN" }, 403);
  }
  const body = setupBodySchema.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!body.success) {
    return reply({ ok: false, error: "INVALID_REQUEST" }, 400);
  }
  if (!tokensMatch(body.data.token, deps.setupToken)) {
    return reply({ ok: false, error: "INVALID_SETUP_TOKEN" }, 401);
  }
  try {
    const result = await deps.bootstrap({
      ownerEmail: body.data.ownerEmail,
      ownerName: body.data.ownerName,
      ownerPassword: body.data.ownerPassword,
      workspaceName: body.data.workspaceName,
      projectName: body.data.projectName,
      allowedOrigins: body.data.allowedOrigins,
    });
    return reply(
      {
        ok: true,
        projectName: result.projectName,
        publicKey: result.publicKey,
        allowedOrigins: result.allowedOrigins,
      },
      201,
    );
  } catch (error) {
    if (error instanceof BootstrapError) {
      return reply({ ok: false, error: error.code }, 400);
    }
    console.error(
      JSON.stringify({
        event: "setup_failed",
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
    return reply({ ok: false, error: "SETUP_FAILED" }, 503);
  }
}

/** Live dependencies; ports load the root env before SETUP_TOKEN is read. */
export function liveSetupDependencies(): SetupDependencies {
  const ports = createBootstrapPorts();
  return {
    setupToken: process.env.SETUP_TOKEN,
    countUsers: () => ports.countUsers(),
    bootstrap: (input) => bootstrapInstallation(ports, input),
  };
}

/** Public URL of this platform, for install snippets. */
export function platformUrl(host: string | null): string {
  const configured = resolveAuthBaseUrl(process.env);
  if (configured) return configured.replace(/\/$/, "");
  return `http://${host ?? "127.0.0.1:3000"}`;
}
