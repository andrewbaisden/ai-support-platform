import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
} from "@typesafe-ai/sdk";

export const aiErrorCodes = [
  "AI_PROVIDER_UNAVAILABLE",
  "AI_TIMEOUT",
  "AI_INVALID_RESPONSE",
  "AI_SCHEMA_VALIDATION_FAILED",
  "AI_MISCONFIGURED",
] as const;

export type AiErrorCode = (typeof aiErrorCodes)[number];

/** Internal AI failure. Never exposed through the public widget API. */
export class AiError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Map official SDK failures to internal codes. The SDK already retries
 * transient faults internally, so anything surfacing here is actionable only
 * via a later manual retry: tickets stay in `needs_triage`.
 */
export function mapJevError(error: unknown): AiError {
  if (error instanceof APITimeoutError) {
    return new AiError(
      "AI_TIMEOUT",
      `Jev request timed out after ${error.timeoutMs}ms`,
      { cause: error },
    );
  }
  if (error instanceof APIUserAbortError) {
    return new AiError("AI_TIMEOUT", "Jev request was aborted", {
      cause: error,
    });
  }
  if (error instanceof APIConnectionError) {
    return new AiError("AI_PROVIDER_UNAVAILABLE", "Cannot reach Jev", {
      cause: error,
    });
  }
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) {
      return new AiError(
        "AI_MISCONFIGURED",
        `Jev rejected authentication (status ${error.status})`,
        { cause: error },
      );
    }
    if (error.status === 429 || error.status >= 500) {
      return new AiError(
        "AI_PROVIDER_UNAVAILABLE",
        `Jev unavailable (status ${error.status})`,
        { cause: error },
      );
    }
    return new AiError(
      "AI_INVALID_RESPONSE",
      `Jev rejected the request (status ${error.status})`,
      { cause: error },
    );
  }
  return new AiError("AI_INVALID_RESPONSE", "Unexpected Jev failure", {
    cause: error,
  });
}
