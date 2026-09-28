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
 * Server-only Better Auth instance. Email/password is the single local
 * credential method; no OAuth, no custom password code. Public signup stays
 * reachable only through the seeded owner flow (the web auth route gates
 * sign-up endpoints separately). Lazily constructed so importing this module
 * never requires credentials at build time.
 */
function createAuth() {
  loadRootEnv();
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new AuthMisconfiguredError(
      "BETTER_AUTH_SECRET is required. See .env.example for local setup.",
    );
  }
  const { db } = getSharedDatabase(requireDatabaseUrl("DATABASE_URL"));
  const email = authEmailOptions(emailSenderFromEnv(process.env));
  return betterAuth({
    baseURL: process.env.BETTER_AUTH_URL,
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
      ...email.emailAndPassword,
    },
  });
}

type AuthInstance = ReturnType<typeof createAuth>;

let cached: AuthInstance | undefined;

export function getAuth(): AuthInstance {
  if (!cached) cached = createAuth();
  return cached;
}

export type Auth = AuthInstance;
