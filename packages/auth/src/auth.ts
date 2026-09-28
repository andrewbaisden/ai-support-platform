import {
  accounts,
  getSharedDatabase,
  loadRootEnv,
  requireDatabaseUrl,
  sessions,
  users,
  verifications,
} from "@ai-support-platform/db";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { emailSenderFromEnv } from "./email";
import { authEmailOptions } from "./email-options";
import { AuthMisconfiguredError } from "./errors";

/**
 * Public base URL for auth callbacks and origin checks. An explicit
 * BETTER_AUTH_URL wins (custom domains); on Vercel it falls back to the
 * project's production domain, which is unknown before the first deploy.
 */
export function resolveAuthBaseUrl(
  env: Record<string, string | undefined>,
): string | undefined {
  const explicit = env.BETTER_AUTH_URL?.trim();
  if (explicit) return explicit;
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : undefined;
}

/**
 * Server-only Better Auth instance. Email/password is the single local
 * credential method; no OAuth, no custom password code. Public signup stays
 * reachable only through controlled owner flows (the web auth route gates
 * sign-up endpoints separately). Lazily constructed so importing this module
 * never requires credentials at build time. The setup variant sends no
 * account email and creates no session: it only provisions the first owner.
 */
function createAuth(mode: "app" | "setup" = "app") {
  loadRootEnv();
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new AuthMisconfiguredError(
      "BETTER_AUTH_SECRET is required. See .env.example for local setup.",
    );
  }
  const { db } = getSharedDatabase(requireDatabaseUrl("DATABASE_URL"));
  const email = authEmailOptions(
    mode === "app" ? emailSenderFromEnv(process.env) : undefined,
  );
  return betterAuth({
    baseURL: resolveAuthBaseUrl(process.env),
    secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
      },
    }),
    ...(email.emailVerification
      ? { emailVerification: email.emailVerification }
      : {}),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      ...(mode === "setup" ? { autoSignIn: false } : {}),
      ...email.emailAndPassword,
    },
  });
}

type AuthInstance = ReturnType<typeof createAuth>;

let cached: AuthInstance | undefined;
let cachedSetup: AuthInstance | undefined;

export function getAuth(): AuthInstance {
  if (!cached) cached = createAuth();
  return cached;
}

/** Auth instance for provisioning owners: no email, no session. */
export function getSetupAuth(): AuthInstance {
  if (!cachedSetup) cachedSetup = createAuth("setup");
  return cachedSetup;
}

export type Auth = AuthInstance;
