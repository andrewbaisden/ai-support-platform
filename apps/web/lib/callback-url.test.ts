import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./callback-url";

describe("post-login callback URL", () => {
  it("keeps same-origin dashboard paths with query and fragment", () => {
    for (const path of [
      "/dashboard",
      "/dashboard/projects/20000000-0000-4000-8000-000000000001/tickets",
      "/dashboard/projects/p/tickets?status=queued&page=2#results",
    ]) {
      expect(safeCallbackUrl(path)).toBe(path);
    }
  });

  it.each([
    null,
    undefined,
    "",
    "dashboard",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/%2F%2Fevil.example",
    "/%2f/evil.example",
    "/%5Cevil.example",
    "/%5c%5cevil.example",
    "/dashboard\\..\\..\\evil",
    "/\t/evil.example",
    "/%09/evil.example",
    " /dashboard",
    "https://evil.example/dashboard",
    "javascript:alert(1)",
    "/login",
    "/api/auth/sign-out",
    `/dashboard/${"a".repeat(600)}`,
  ])("falls back to /dashboard for %j", (value) => {
    expect(safeCallbackUrl(value)).toBe("/dashboard");
  });
});
