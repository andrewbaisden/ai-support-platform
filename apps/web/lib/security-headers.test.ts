// @vitest-environment node
import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

function asMap(headers: Array<{ key: string; value: string }>) {
  return Object.fromEntries(headers.map(({ key, value }) => [key, value]));
}

describe("platform security headers", () => {
  it("forbids framing, sniffing, and cross-origin referrer leaks", () => {
    expect(asMap(securityHeaders("development"))).toEqual({
      "Content-Security-Policy": "frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  it("adds HSTS only in production, where the platform must be HTTPS", () => {
    expect(asMap(securityHeaders("production"))).toMatchObject({
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    });
    expect(asMap(securityHeaders("development"))).not.toHaveProperty(
      "Strict-Transport-Security",
    );
  });
});
