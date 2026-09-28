/**
 * Response headers for every platform route. The dashboard and login must
 * never be framed (clickjacking), responses must not be MIME-sniffed, and
 * dashboard URLs must not leak cross-origin through Referer. HSTS applies
 * only in production, where the platform is served over HTTPS. The public
 * ingestion API keeps its own CORS headers; nothing here restricts callers.
 */
export function securityHeaders(
  nodeEnv: string | undefined,
): Array<{ key: string; value: string }> {
  const headers = [
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    },
  ];
  if (nodeEnv === "production") {
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  }
  return headers;
}
