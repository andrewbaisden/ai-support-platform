import { describe, expect, it } from "vitest";
import { productionConfigProblems } from "./production-config";

const strongSecret = "k4R9vQ2mX7pL1zN8sT5wY3bC6dF0gH2jK4mP7qS9uV1x";
const safe = {
  NODE_ENV: "production",
  BETTER_AUTH_SECRET: strongSecret,
  BETTER_AUTH_URL: "https://support.example.com",
  GITHUB_WEBHOOK_SECRET: "e".repeat(64),
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
    ]);
    expect(JSON.stringify(problems)).not.toContain("local-dev-only");
    expect(JSON.stringify(problems)).not.toContain("short");
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
