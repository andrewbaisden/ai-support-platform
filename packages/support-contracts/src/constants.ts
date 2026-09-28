/**
 * Plain submission-contract values with no runtime dependencies. The
 * browser widget validates with these directly, so it never loads Zod:
 * Zod's eval-support probe is reported as a violation by strict-CSP hosts.
 * The Zod schemas in `./index` are built from the same values.
 */
export const supportCategories = [
  "question",
  "bug",
  "feature_request",
] as const;
export type SupportCategory = (typeof supportCategories)[number];

export const MESSAGE_MIN_LENGTH = 10;
export const MESSAGE_MAX_LENGTH = 10_000;
export const CONTACT_NAME_MAX_LENGTH = 120;
export const CONTACT_EMAIL_MAX_LENGTH = 320;

/** Same pattern as Zod's `z.email()` default, so client and server agree. */
export const EMAIL_PATTERN =
  /^(?:[A-Za-z0-9_'+-]+\.)*[A-Za-z0-9_'+-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;
export const PUBLIC_PROJECT_KEY_PATTERN = /^pk_[A-Za-z0-9_-]{32}$/;
export const TICKET_REFERENCE_PATTERN = /^SUP-[1-9][0-9]*$/;

export const publicErrorCodes = [
  "INVALID_REQUEST",
  "PROJECT_NOT_FOUND",
  "ORIGIN_NOT_ALLOWED",
  "RATE_LIMITED",
  "SUBMISSION_CONFLICT",
  "SUBMISSION_FAILED",
  "BODY_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
] as const;
export type PublicErrorCode = (typeof publicErrorCodes)[number];
