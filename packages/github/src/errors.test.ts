import { describe, expect, it } from "vitest";
import { GithubError, mapRequestError } from "./errors";

function statusError(status: number, message = "error") {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

describe("GitHub error mapping", () => {
  it("maps statuses without leaking response detail", () => {
    expect(mapRequestError(statusError(401)).code).toBe("GITHUB_AUTH_FAILED");
    expect(mapRequestError(statusError(404)).code).toBe(
      "GITHUB_REPOSITORY_NOT_FOUND",
    );
    expect(mapRequestError(statusError(429)).code).toBe("GITHUB_RATE_LIMITED");
    expect(mapRequestError(statusError(500)).code).toBe("GITHUB_UNAVAILABLE");
    expect(
      mapRequestError(statusError(403, "API rate limit exceeded")).code,
    ).toBe("GITHUB_RATE_LIMITED");
    expect(
      mapRequestError(statusError(403, "Resource not accessible")).code,
    ).toBe("GITHUB_PERMISSION_DENIED");
    expect(mapRequestError(new Error("socket hang up")).code).toBe(
      "GITHUB_UNAVAILABLE",
    );
    const mapped = mapRequestError(statusError(500, "secret-token-body"));
    expect(mapped).toBeInstanceOf(GithubError);
    expect(mapped.message).not.toContain("secret-token-body");
  });
});
