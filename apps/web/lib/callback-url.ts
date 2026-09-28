const FALLBACK = "/dashboard";
const MAX_LENGTH = 512;
const PROBE_ORIGIN = "http://callback.invalid";

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Post-login destination, restricted to same-origin dashboard paths. Browser
 * URL parsers treat `\` like `/` and ignore tabs and newlines, so `/\host`
 * or `/\t/host` become protocol-relative redirects. Encoded slashes can be
 * decoded again downstream. Anything that is not plainly a dashboard path
 * falls back to the dashboard. Browser-safe: shared by server and client.
 */
export function safeCallbackUrl(value: string | null | undefined): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_LENGTH ||
    !value.startsWith("/") ||
    /[\\\s]/.test(value) ||
    hasControlCharacter(value) ||
    /%(2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)
  ) {
    return FALLBACK;
  }
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return FALLBACK;
  }
  if (
    url.origin !== PROBE_ORIGIN ||
    (url.pathname !== FALLBACK && !url.pathname.startsWith(`${FALLBACK}/`))
  ) {
    return FALLBACK;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
