import { describe, expect, it } from "vitest";
import { productionConfigProblems } from "./production-config";

const strongSecret = "k4R9vQ2mX7pL1zN8sT5wY3bC6dF0gH2jK4mP7qS9uV1x";
const safe = {
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: strongSecret,
  BETTER_AUTH_URL: "https://support.example.com",
  GITHUB_WEBHOOK_SECRET: "e".repeat(64),
  CRON_SECRET: "c9Xk2LmQ7vB4nR8tW1yZ5aD3fG6hJ0pS",
};

describe("production configuration guard", () => {
  it("accepts a production configuration with unique secrets over HTTPS", () => {
    expect(productionConfigProblems(safe)).toEqual([]);
    const { GITHUB_WEBHOOK_SECRET: _unused, ...withoutWebhook } = safe;
    expect(productionConfigProblems(withoutWebhook)).toEqual([]);
  });

  it("does not police local development", () => {
    expect(
      productionConfigProblems({
        NODE_ENV: "development",
        BETTER_AUTH_SECRET:
          "local-dev-only-change-me-in-production-0123456789abcdef",
        BETTER_AUTH_URL: "http://127.0.0.1:3000",
      }),
    ).toEqual([]);
  });

  it("names each unsafe production setting without echoing its value", () => {
    const problems = productionConfigProblems({
      NODE_ENV: "production",
      BETTER_AUTH_SECRET:
        "local-dev-only-change-me-in-production-0123456789abcdef",
      BETTER_AUTH_URL: "http://support.example.com",
      GITHUB_WEBHOOK_SECRET: "short",
      GITHUB_ESCALATION_MOCK: "1",
      AUTH_ALLOW_SIGNUP: "true",
    });
    expect(problems).toEqual([
      "BETTER_AUTH_SECRET is the documented example value",
      "BETTER_AUTH_URL must be an https:// URL",
      "GITHUB_WEBHOOK_SECRET must be at least 32 characters",
      "GITHUB_ESCALATION_MOCK must not be set in production",
      "AUTH_ALLOW_SIGNUP requires email verification, which is not configured",
      "CRON_SECRET must be at least 32 characters",
    ]);
    expect(JSON.stringify(problems)).not.toContain("local-dev-only");
    expect(JSON.stringify(problems)).not.toContain("short");
  });

  it("requires a strong cron secret so scheduled retention cannot silently stop", () => {
    const { CRON_SECRET: _cron, ...withoutCron } = safe;
    expect(productionConfigProblems(withoutCron)).toEqual([
      "CRON_SECRET must be at least 32 characters",
    ]);
    expect(productionConfigProblems({ ...safe, CRON_SECRET: "short" })).toEqual(
      ["CRON_SECRET must be at least 32 characters"],
    );
  });

  it("requires complete email settings and allows signup only with them", () => {
    expect(
      productionConfigProblems({
        ...safe,
        RESEND_API_KEY: "re_live_key_value",
      }),
    ).toEqual(["RESEND_API_KEY and EMAIL_FROM must be set together"]);
    expect(
      productionConfigProblems({
        ...safe,
        EMAIL_FROM: "IssueRelay <no-reply@mail.example.test>",
      }),
    ).toEqual(["RESEND_API_KEY and EMAIL_FROM must be set together"]);
    expect(
      productionConfigProblems({
        ...safe,
        RESEND_API_KEY: "re_live_key_value",
        EMAIL_FROM: "not an address",
      }),
    ).toEqual(["EMAIL_FROM must contain a sender email address"]);
    expect(
      productionConfigProblems({
        ...safe,
        RESEND_API_KEY: "re_live_key_value",
        EMAIL_FROM: "IssueRelay <no-reply@mail.example.test>",
        AUTH_ALLOW_SIGNUP: "true",
      }),
    ).toEqual([]);
  });

  it("accepts Vercel's production domain when BETTER_AUTH_URL is unset", () => {
    const { BETTER_AUTH_URL: _url, ...withoutUrl } = safe;
    expect(
      productionConfigProblems({
        ...withoutUrl,
        VERCEL_PROJECT_PRODUCTION_URL: "issuerelay-self.vercel.app",
      }),
    ).toEqual([]);
    expect(productionConfigProblems(withoutUrl)).toEqual([
      "BETTER_AUTH_URL must be an https:// URL",
    ]);
  });

  it("requires a strong first-run setup token when one is set", () => {
    expect(productionConfigProblems({ ...safe, SETUP_TOKEN: "short" })).toEqual(
      ["SETUP_TOKEN must be at least 32 characters"],
    );
    expect(
      productionConfigProblems({
        ...safe,
        SETUP_TOKEN: "k4R9vQ2mX7pL1zN8sT5wY3bC6dF0gH2jK4mP",
      }),
    ).toEqual([]);
  });

  it("rejects missing, short, and low-variety auth secrets", () => {
    expect(
      productionConfigProblems({ ...safe, BETTER_AUTH_SECRET: undefined }),
    ).toEqual(["BETTER_AUTH_SECRET is required"]);
    expect(
      productionConfigProblems({ ...safe, BETTER_AUTH_SECRET: "abc123" }),
    ).toEqual(["BETTER_AUTH_SECRET must be at least 32 characters"]);
    expect(
      productionConfigProblems({ ...safe, BETTER_AUTH_SECRET: "a".repeat(40) }),
    ).toEqual(["BETTER_AUTH_SECRET is not random enough"]);
    expect(
      productionConfigProblems({ ...safe, BETTER_AUTH_URL: "not a url" }),
    ).toEqual(["BETTER_AUTH_URL must be an https:// URL"]);
  });
});
