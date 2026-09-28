// @vitest-environment node
import { GithubError } from "@ai-support-platform/github";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEscalationTrackers } from "./github-tracker";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("escalation tracker selection", () => {
  it("uses the network-free mock only outside production when explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("GITHUB_ESCALATION_MOCK", "1");
    expect(createEscalationTrackers()).toHaveProperty("created");
  });

  it("never selects the mock in production and fails closed without App credentials", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GITHUB_ESCALATION_MOCK", "1");
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    expect(() => createEscalationTrackers()).toThrow(
      expect.objectContaining({ code: "GITHUB_MISCONFIGURED" }),
    );
  });

  it("does not fall back to the mock when the flag is absent", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GITHUB_ESCALATION_MOCK", "");
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
    expect(() => createEscalationTrackers()).toThrow(GithubError);
  });
});
