import { GithubError } from "./errors";
import type { CreatedIssue, IssueTrackerClient, TrackerFactory } from "./types";

export type MockScenario =
  | { kind: "success"; issue?: Partial<CreatedIssue> }
  | { kind: "auth-failure" }
  | { kind: "permission-denied" }
  | { kind: "repository-missing" }
  | { kind: "rate-limited" }
  | { kind: "timeout" }
  | { kind: "unavailable" }
  | { kind: "ambiguous-then-found"; issue?: Partial<CreatedIssue> }
  | { kind: "ambiguous-then-missing" };

/**
 * Deterministic fake adapter for CI, E2E, and development. Scripted per
 * installation; scenarios model transport/API outcomes without network.
 * Success IDs derive from the issue marker so the same ticket always maps
 * to the same mock issue (idempotent) while different tickets never share
 * a remote ID (respects the unique remote constraint across runs).
 */
function mockIssueFor(
  owner: string,
  repo: string,
  marker: string,
): CreatedIssue {
  let hash = 0x811c9dc5;
  const input = `${owner}/${repo}/${marker}`;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const number = 1 + (Math.abs(hash) % 4999);
  return {
    id: 100000 + (Math.abs(hash) % 800000),
    number,
    url: `https://github.com/${owner}/${repo}/issues/${number}`,
  };
}

/**
 * Deterministic fake adapter for CI, E2E, and development. Scripted per
 * installation; scenarios model transport/API outcomes without network.
 */
export function createMockTrackerFactory(
  scenarios: MockScenario[] = [{ kind: "success" }],
): TrackerFactory & {
  created: Array<{
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels: string[];
  }>;
} {
  const created: Array<{
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels: string[];
  }> = [];
  let calls = 0;
  const next = (): MockScenario =>
    scenarios[Math.min(calls, scenarios.length - 1)] ?? { kind: "success" };
  const client: IssueTrackerClient = {
    async verifyRepository() {},
    async createIssue(input) {
      const scenario = next();
      calls += 1;
      switch (scenario.kind) {
        case "success": {
          created.push(input);
          const marker =
            input.body.match(/<!-- ai-support-ticket:[^>]+-->/)?.[0] ??
            input.body;
          return {
            ...mockIssueFor(input.owner, input.repo, marker),
            ...scenario.issue,
          };
        }
        case "auth-failure":
          throw new GithubError("GITHUB_AUTH_FAILED", "Mock auth failure");
        case "permission-denied":
          throw new GithubError(
            "GITHUB_PERMISSION_DENIED",
            "Mock permission failure",
          );
        case "repository-missing":
          throw new GithubError(
            "GITHUB_REPOSITORY_NOT_FOUND",
            "Mock missing repository",
          );
        case "rate-limited":
          throw new GithubError("GITHUB_RATE_LIMITED", "Mock rate limit");
        case "timeout":
          throw new GithubError("GITHUB_TIMEOUT", "Mock timeout");
        case "unavailable":
          throw new GithubError("GITHUB_UNAVAILABLE", "Mock outage");
        case "ambiguous-then-found":
          throw new GithubError(
            "GITHUB_CREATION_UNKNOWN",
            "Mock ambiguous create",
          );
        case "ambiguous-then-missing":
          throw new GithubError(
            "GITHUB_CREATION_UNKNOWN",
            "Mock ambiguous create",
          );
      }
    },
    async findIssueByMarker(input) {
      const scenario = scenarios[Math.min(calls, scenarios.length - 1)] ?? {
        kind: "success",
      };
      if (scenario.kind === "ambiguous-then-found") {
        return {
          ...mockIssueFor(input.owner, input.repo, input.marker),
          number: 7,
          url: `https://github.com/${input.owner}/${input.repo}/issues/7`,
          ...scenario.issue,
        };
      }
      const match = created.find(
        (issue) =>
          issue.owner === input.owner &&
          issue.repo === input.repo &&
          issue.body
            .split(/\r?\n/)
            .some((line) => line.trim() === input.marker),
      );
      return match
        ? mockIssueFor(input.owner, input.repo, input.marker)
        : undefined;
    },
    async listLabels() {
      return ["bug", "severity:high", "severity:critical", "help wanted"];
    },
  };
  return {
    async forInstallation() {
      return client;
    },
    created,
  };
}
