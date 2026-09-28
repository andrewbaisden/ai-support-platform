/** Example values shipped in `.env.example`; never valid in production. */
const EXAMPLE_AUTH_SECRETS = new Set([
  "local-dev-only-change-me-in-production-0123456789abcdef",
]);
const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARACTERS = 10;

type Env = Record<string, string | undefined>;

/**
 * Settings that must not reach a production server: example or weak
 * secrets, plain-HTTP auth URLs, test hooks, incomplete email settings,
 * self-signup without email verification, and a missing cron secret.
 * Reports setting names only, never their values.
 */
export function productionConfigProblems(env: Env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const problems: string[] = [];

  const authSecret = env.BETTER_AUTH_SECRET;
  if (!authSecret) {
    problems.push("BETTER_AUTH_SECRET is required");
  } else if (EXAMPLE_AUTH_SECRETS.has(authSecret)) {
    problems.push("BETTER_AUTH_SECRET is the documented example value");
  } else if (authSecret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  } else if (new Set(authSecret).size < MIN_DISTINCT_CHARACTERS) {
    problems.push("BETTER_AUTH_SECRET is not random enough");
  }

  let authUrlSecure = false;
  try {
    authUrlSecure = new URL(env.BETTER_AUTH_URL ?? "").protocol === "https:";
  } catch {
    authUrlSecure = false;
  }
  if (!authUrlSecure) problems.push("BETTER_AUTH_URL must be an https:// URL");

  const webhookSecret = env.GITHUB_WEBHOOK_SECRET;
  if (webhookSecret !== undefined && webhookSecret.length < MIN_SECRET_LENGTH) {
    problems.push(
      `GITHUB_WEBHOOK_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  if (env.GITHUB_ESCALATION_MOCK) {
    problems.push("GITHUB_ESCALATION_MOCK must not be set in production");
  }
  const resendKey = Boolean(env.RESEND_API_KEY?.trim());
  const emailFrom = env.EMAIL_FROM?.trim();
  if (resendKey !== Boolean(emailFrom)) {
    problems.push("RESEND_API_KEY and EMAIL_FROM must be set together");
  } else if (
    emailFrom &&
    !/<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(emailFrom)
  ) {
    problems.push("EMAIL_FROM must contain a sender email address");
  }
  const emailConfigured = resendKey && Boolean(emailFrom);
  if (env.AUTH_ALLOW_SIGNUP === "true" && !emailConfigured) {
    problems.push(
      "AUTH_ALLOW_SIGNUP requires email verification, which is not configured",
    );
  }
  // Vercel Cron authenticates to the retention route with this secret.
  if ((env.CRON_SECRET?.length ?? 0) < MIN_SECRET_LENGTH) {
    problems.push(
      `CRON_SECRET must be at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return problems;
}
