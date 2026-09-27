export const githubErrorCodes = [
  "GITHUB_NOT_CONFIGURED",
  "GITHUB_NOT_ELIGIBLE",
  "GITHUB_BLOCKED",
  "GITHUB_ALREADY_LINKED",
  "GITHUB_AUTH_FAILED",
  "GITHUB_PERMISSION_DENIED",
  "GITHUB_REPOSITORY_NOT_FOUND",
  "GITHUB_RATE_LIMITED",
  "GITHUB_TIMEOUT",
  "GITHUB_UNAVAILABLE",
  "GITHUB_INVALID_RESPONSE",
  "GITHUB_CREATION_UNKNOWN",
  "GITHUB_MISCONFIGURED",
] as const;

export type GithubErrorCode = (typeof githubErrorCodes)[number];

/** Internal GitHub failure. Never exposes tokens or raw API responses. */
export class GithubError extends Error {
  constructor(
    public readonly code: GithubErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

interface RequestFailure {
  status?: number;
  message?: string;
}

/**
 * Map transport/API failures. Timeouts and connection losses after send are
 * ambiguous by design: the issue may exist remotely. HTTP error responses
 * are definitive failures (a later attempt reconciles by marker first).
 */
export function mapRequestError(error: unknown): GithubError {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status: unknown }).status)
      : Number.NaN;
  const message =
    error instanceof Error ? error.message : "GitHub request failed";
  if (!Number.isFinite(status)) {
    return new GithubError("GITHUB_UNAVAILABLE", "Cannot reach GitHub", {
      cause: error,
    });
  }
  if (status === 401) {
    return new GithubError(
      "GITHUB_AUTH_FAILED",
      "GitHub rejected credentials",
      {
        cause: error,
      },
    );
  }
  if (status === 403) {
    if (/rate limit|secondary rate|abuse/i.test(message)) {
      return new GithubError("GITHUB_RATE_LIMITED", "GitHub rate limit hit", {
        cause: error,
      });
    }
    return new GithubError(
      "GITHUB_PERMISSION_DENIED",
      "GitHub App lacks permission",
      { cause: error },
    );
  }
  if (status === 404) {
    return new GithubError(
      "GITHUB_REPOSITORY_NOT_FOUND",
      "Repository or installation not found",
      { cause: error },
    );
  }
  if (status === 429) {
    return new GithubError("GITHUB_RATE_LIMITED", "GitHub rate limit hit", {
      cause: error,
    });
  }
  return new GithubError(
    "GITHUB_UNAVAILABLE",
    `GitHub request failed (status ${status})`,
    { cause: error },
  );
}

export type { RequestFailure };
