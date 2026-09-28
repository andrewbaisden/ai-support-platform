// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { TicketScope } from "./dashboard-api";
import {
  handleProjectSettingsPost,
  type ProjectSettingsDependencies,
} from "./project-settings";

const PROJECT = "11111111-1111-4111-8111-111111111111";

function fakeRepository(connected = false) {
  return {
    updateProjectAllowedOrigins: vi.fn(
      async (_w: string, _p: string, allowedOrigins: string[]) => ({
        allowedOrigins,
      }),
    ),
    getIntegrationForProject: vi.fn(async () =>
      connected ? { repositoryOwner: "o", repositoryName: "r" } : undefined,
    ),
    connectGitHubRepository: vi.fn(async () => ({})),
  };
}

function deps(
  repository = fakeRepository(),
  overrides: Partial<ProjectSettingsDependencies> = {},
) {
  const scope = {
    userId: "u",
    access: { workspaceId: "ws", workspaceName: "W", role: "owner" },
    repository,
  } as unknown as TicketScope;
  return {
    scope: vi.fn(async () => scope),
    lookupInstallation: vi.fn(async (owner: string, repo: string) => ({
      installationId: "77",
      repositoryId: "4242",
      owner: owner.toLowerCase(),
      repo: repo.toLowerCase(),
    })),
    appInstallUrl: vi.fn(
      async () => "https://github.com/apps/my-app/installations/new",
    ),
    ...overrides,
  } satisfies ProjectSettingsDependencies;
}

function post(body: unknown) {
  return new Request(
    `https://app.example.test/api/dashboard/projects/${PROJECT}/settings`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

describe("project settings", () => {
  it("returns the scope error for non-owners without touching data", async () => {
    const repository = fakeRepository();
    const d = deps(repository, {
      scope: vi.fn(async () => ({ error: "OWNER_REQUIRED" as const })),
    });
    const response = await handleProjectSettingsPost(
      post({ action: "origins", allowedOrigins: [] }),
      PROJECT,
      d,
    );
    expect(response.status).toBe(403);
    expect(repository.updateProjectAllowedOrigins).not.toHaveBeenCalled();
  });

  it("replaces allowed origins after validating them", async () => {
    const repository = fakeRepository();
    const ok = await handleProjectSettingsPost(
      post({
        action: "origins",
        allowedOrigins: ["https://site.example.test", "http://localhost:3000"],
      }),
      PROJECT,
      deps(repository),
    );
    expect(ok.status).toBe(200);
    expect(repository.updateProjectAllowedOrigins).toHaveBeenCalledWith(
      "ws",
      PROJECT,
      ["https://site.example.test", "http://localhost:3000"],
    );
    for (const allowedOrigins of [
      ["https://site.example.test/path"],
      ["not a url"],
      Array.from({ length: 21 }, (_, i) => `https://s${i}.example.test`),
    ]) {
      const bad = await handleProjectSettingsPost(
        post({ action: "origins", allowedOrigins }),
        PROJECT,
        deps(repository),
      );
      expect(bad.status).toBe(400);
    }
    expect(repository.updateProjectAllowedOrigins).toHaveBeenCalledTimes(1);
  });

  it("connects using the repository identity GitHub reports", async () => {
    const repository = fakeRepository();
    const d = deps(repository);
    const response = await handleProjectSettingsPost(
      post({ action: "connect", repository: "Owner/Site" }),
      PROJECT,
      d,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      repository: "owner/site",
    });
    expect(d.lookupInstallation).toHaveBeenCalledWith("Owner", "Site");
    expect(repository.connectGitHubRepository).toHaveBeenCalledWith({
      workspaceId: "ws",
      projectId: PROJECT,
      installationId: 77n,
      repositoryId: 4242n,
      repositoryOwner: "owner",
      repositoryName: "site",
    });
  });

  it("explains when the App is not installed, not configured, or already connected", async () => {
    const notInstalled = await handleProjectSettingsPost(
      post({ action: "connect", repository: "o/r" }),
      PROJECT,
      deps(fakeRepository(), {
        lookupInstallation: vi.fn(async () => undefined),
      }),
    );
    expect(notInstalled.status).toBe(422);
    expect(await notInstalled.json()).toEqual({
      ok: false,
      error: "APP_NOT_INSTALLED",
      installUrl: "https://github.com/apps/my-app/installations/new",
    });

    const { GithubError } = await import("@ai-support-platform/github");
    const unconfigured = await handleProjectSettingsPost(
      post({ action: "connect", repository: "o/r" }),
      PROJECT,
      deps(fakeRepository(), {
        lookupInstallation: vi.fn(async () => {
          throw new GithubError("GITHUB_MISCONFIGURED", "missing");
        }),
      }),
    );
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toMatchObject({
      error: "GITHUB_NOT_CONFIGURED",
    });

    const repository = fakeRepository(true);
    const d = deps(repository);
    const already = await handleProjectSettingsPost(
      post({ action: "connect", repository: "o/r" }),
      PROJECT,
      d,
    );
    expect(already.status).toBe(409);
    expect(d.lookupInstallation).not.toHaveBeenCalled();
  });

  it("rejects malformed repository names and unknown actions", async () => {
    for (const body of [
      { action: "connect", repository: "no-slash" },
      { action: "connect", repository: "o/r/extra" },
      { action: "connect", repository: "https://github.com/o/r" },
      { action: "delete" },
      { action: "origins", allowedOrigins: [], extra: 1 },
    ]) {
      const response = await handleProjectSettingsPost(
        post(body),
        PROJECT,
        deps(),
      );
      expect(response.status).toBe(400);
    }
  });
});
