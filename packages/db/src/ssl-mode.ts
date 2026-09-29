const VERIFY_FULL_ALIASES = new Set(["prefer", "require", "verify-ca"]);

/**
 * pg currently treats `sslmode=prefer|require|verify-ca` as `verify-full`
 * and warns on every connection (Neon URLs use `require`). Spelling out
 * `verify-full` keeps today's certificate checks and silences the warning;
 * URLs without sslmode, or opting into libpq semantics, are unchanged.
 */
export function withExplicitSslMode(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }
  const mode = url.searchParams.get("sslmode");
  if (
    !mode ||
    !VERIFY_FULL_ALIASES.has(mode) ||
    url.searchParams.get("uselibpqcompat") === "true"
  ) {
    return connectionString;
  }
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
