import { App } from "@octokit/app";
import { GithubError, mapRequestError } from "./errors";
import { trustedReconciliationIssue } from "./reconciliation";
import type { CreatedIssue, IssueTrackerClient, TrackerFactory } from "./types";

const REQUEST_TIMEOUT_MS = 10_000;
const RECONCILE_PAGES = 3;
const RECONCILE_PER_PAGE = 100;

function isGithubUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}

const createdIssueSchema = {
  parse(value: unknown): CreatedIssue {
    if (typeof value !== "object" || value === null) {
      throw new GithubError("GITHUB_INVALID_RESPONSE", "Empty issue response");
    }
    const record = value as Record<string, unknown>;
    const id = record.id;
    const number = record.number;
    const url = record.html_url;
    if (
      typeof id !== "number" ||
      !Number.isInteger(id) ||
      typeof number !== "number" ||
      !Number.isInteger(number) ||
      !isGithubUrl(url)
    ) {
      throw new GithubError(
        "GITHUB_INVALID_RESPONSE",
        "Issue response failed validation",
      );
    }
    return { id, number, url };
  },
};

function toGithubError(error: unknown): GithubError {
  if (error instanceof GithubError) return error;
  if (error instanceof Error && error.name === "TimeoutError") {
    return new GithubError("GITHUB_TIMEOUT", "GitHub request timed out", {
      cause: error,
    });
  }
  return mapRequestError(error);
}

async function withTimeout<T>(label: string, task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label} timed out`);
          error.name = "TimeoutError";
          reject(error);
        }, REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * GitHub App adapter. JWT signing and installation-token minting stay inside
 * the official SDK; tokens are held in memory by Octokit and never persisted.
 */
export function createTrackerFactory(options: {
  appId: string;
  privateKey: string;
}): TrackerFactory {
  if (!options.appId || !options.privateKey) {
    throw new GithubError(
      "GITHUB_MISCONFIGURED",
      "GitHub App ID and private key are required",
    );
  }
  const app = new App({
    appId: options.appId,
    privateKey: options.privateKey,
  });
  return {
    async forInstallation(installationId: string): Promise<IssueTrackerClient> {
      let octokit: Awaited<ReturnType<App["getInstallationOctokit"]>>;
      try {
        octokit = await withTimeout(
          "installation token",
          app.getInstallationOctokit(Number(installationId)),
        );
      } catch (error) {
        throw toGithubError(error);
      }
      return {
        async verifyRepository(input) {
          try {
            const response = await withTimeout(
              "verify repository",
              octokit.request("GET /repos/{owner}/{repo}", {
                owner: input.owner,
                repo: input.repo,
              }),
            );
            if (String(response.data.id) !== input.repositoryId) {
              throw new GithubError(
                "GITHUB_REPOSITORY_NOT_FOUND",
                "Configured repository identity mismatch",
              );
            }
          } catch (error) {
            throw toGithubError(error);
          }
        },
        async createIssue(input) {
          try {
            const response = await withTimeout(
              "create issue",
              octokit.request("POST /repos/{owner}/{repo}/issues", {
                owner: input.owner,
                repo: input.repo,
                title: input.title,
                body: input.body,
                labels: input.labels,
              }),
            );
            if (response.status !== 201) {
              throw new GithubError(
                "GITHUB_INVALID_RESPONSE",
                `Unexpected issue status ${response.status}`,
              );
            }
            return createdIssueSchema.parse(response.data);
          } catch (error) {
            throw toGithubError(error);
          }
        },
        async findIssueByMarker(input) {
          try {
            const appResponse = await withTimeout(
              "app identity",
              app.octokit.request("GET /app"),
            );
            const appSlug = appResponse.data?.slug;
            if (typeof appSlug !== "string" || !appSlug) {
              throw new GithubError(
                "GITHUB_INVALID_RESPONSE",
                "App identity unavailable",
              );
            }
            for (let page = 1; page <= RECONCILE_PAGES; page++) {
              const response = await withTimeout(
                "reconcile issues",
                octokit.request("GET /repos/{owner}/{repo}/issues", {
                  owner: input.owner,
                  repo: input.repo,
                  state: "all",
                  per_page: RECONCILE_PER_PAGE,
                  page,
                  sort: "created",
                  direction: "desc",
                }),
              );
              const issues = Array.isArray(response.data) ? response.data : [];
              for (const issue of issues) {
                const trusted = trustedReconciliationIssue(
                  issue,
                  input.marker,
                  appSlug,
                );
                if (trusted) return trusted;
              }
              if (issues.length < RECONCILE_PER_PAGE) break;
            }
            return undefined;
          } catch (error) {
            throw toGithubError(error);
          }
        },
        async getIssueState(input) {
          try {
            const response = await withTimeout(
              "issue state",
              octokit.request(
                "GET /repos/{owner}/{repo}/issues/{issue_number}",
                {
                  owner: input.owner,
                  repo: input.repo,
                  issue_number: input.number,
                },
              ),
            );
            const state = response.data.state;
            if (state !== "open" && state !== "closed") {
              throw new GithubError(
                "GITHUB_INVALID_RESPONSE",
                "Issue state failed validation",
              );
            }
            return {
              state,
              ...(typeof response.data.updated_at === "string"
                ? { updatedAt: response.data.updated_at }
                : {}),
            };
          } catch (error) {
            throw toGithubError(error);
          }
        },
        async listLabels(input) {
          try {
            const response = await withTimeout(
              "list labels",
              octokit.request("GET /repos/{owner}/{repo}/labels", {
                owner: input.owner,
                repo: input.repo,
                per_page: 100,
              }),
            );
            const labels = Array.isArray(response.data) ? response.data : [];
            return labels
              .map((label) =>
                typeof label === "object" && label !== null
                  ? (label as { name?: unknown }).name
                  : undefined,
              )
              .filter((name): name is string => typeof name === "string");
          } catch (error) {
            throw toGithubError(error);
          }
        },
      };
    },
  };
}

export interface RepositoryInstallation {
  installationId: string;
  repositoryId: string;
  owner: string;
  repo: string;
}

/**
 * Resolve which installation of this App covers `owner/repo`, then read the
 * repository's canonical identity with that installation's token (the same
 * rule escalation uses before creating). Undefined when the App is not
 * installed on the repository or cannot see it.
 */
export async function lookupRepositoryInstallation(
  options: { appId: string; privateKey: string },
  input: { owner: string; repo: string },
): Promise<RepositoryInstallation | undefined> {
  if (!options.appId || !options.privateKey) {
    throw new GithubError(
      "GITHUB_MISCONFIGURED",
      "GitHub App ID and private key are required",
    );
  }
  const app = new App({ appId: options.appId, privateKey: options.privateKey });
  let installationId: number;
  try {
    const installation = await withTimeout(
      "repository installation",
      app.octokit.request("GET /repos/{owner}/{repo}/installation", input),
    );
    installationId = installation.data.id;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw toGithubError(error);
  }
  try {
    const octokit = await withTimeout(
      "installation token",
      app.getInstallationOctokit(installationId),
    );
    const repository = await withTimeout(
      "repository",
      octokit.request("GET /repos/{owner}/{repo}", input),
    );
    return {
      installationId: String(installationId),
      repositoryId: String(repository.data.id),
      owner: repository.data.owner.login,
      repo: repository.data.name,
    };
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw toGithubError(error);
  }
}

function isNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: unknown }).status === 404
  );
}

/** Where an owner installs this App on a repository (best effort). */
export async function fetchAppInstallUrl(options: {
  appId: string;
  privateKey: string;
}): Promise<string | undefined> {
  try {
    const app = new App({
      appId: options.appId,
      privateKey: options.privateKey,
    });
    const response = await withTimeout("app", app.octokit.request("GET /app"));
    const slug = response.data?.slug;
    return typeof slug === "string" && slug
      ? `https://github.com/apps/${slug}/installations/new`
      : undefined;
  } catch {
    return undefined;
  }
}
