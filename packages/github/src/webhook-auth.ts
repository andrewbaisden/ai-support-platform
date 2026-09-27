import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a GitHub webhook payload against X-Hub-Signature-256.
 * HMAC-SHA256 hex digest over the exact raw bytes, `sha256=` prefixed,
 * compared in constant time. Returns false for missing, malformed, or
 * mismatched signatures without revealing which.
 */
export function verifyWebhookSignature(input: {
  secret: string;
  rawBody: Uint8Array;
  signatureHeader: string | null;
}): boolean {
  const { secret, rawBody, signatureHeader } = input;
  if (!secret || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }
  const hex = signatureHeader.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/.test(hex)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const actual = Buffer.from(hex, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Sign a payload exactly as GitHub does (tests and local tooling). */
export function signWebhookPayload(
  secret: string,
  rawBody: Uint8Array,
): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}
