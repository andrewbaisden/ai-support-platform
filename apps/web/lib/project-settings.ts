import { createHash } from "node:crypto";
import { projectOriginsSchema } from "@ai-support-platform/db";
import {
  fetchAppInstallUrl,
  GithubError,
  lookupRepositoryInstallation,
  type RepositoryInstallation,
} from "@ai-support-platform/github";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireTicketScope,
  scopeErrorResponse,
  type TicketScope,
} from "./dashboard-api";
import { usesMockEscalation } from "./github-tracker";

const bodySchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("origins"),
    allowedOrigins: z.array(z.string().trim().min(1)).max(20),
  }),
  z.strictObject({
    action: z.literal("connect"),
    repository: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/),
  }),
]);

export interface ProjectSettingsDependencies {
  /** Session, same-origin, membership, and owner-role gate. */
  scope(request: Request, projectId: string): Promise<TicketScope>;
  lookupInstallation(
    owner: string,
    repo: string,
  ): Promise<RepositoryInstallation | undefined>;
  appInstallUrl(): Promise<string | undefined>;
}

function reply(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Owner-only project settings: replace allowed origins, or connect the
 * project to a repository the GitHub App is installed on. The repository's
 * identity comes from GitHub, never from the request.
 */
export async function handleProjectSettingsPost(
  request: Request,
  projectId: string,
  deps: ProjectSettingsDependencies,
): Promise<Response> {
  const scoped = await deps.scope(request, projectId);
  if ("error" in scoped) return scopeErrorResponse(scoped.error);
  const body = bodySchema.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!body.success) return reply({ ok: false, error: "INVALID_REQUEST" }, 400);
  const { workspaceId } = scoped.access;
  const { repository } = scoped;

  if (body.data.action === "origins") {
    const origins = projectOriginsSchema.safeParse(body.data.allowedOrigins);
    if (!origins.success) {
      return reply({ ok: false, error: "INVALID_ORIGINS" }, 400);
    }
    const project = await repository.updateProjectAllowedOrigins(
      workspaceId,
      projectId,
      origins.data,
    );
    return reply({ ok: true, allowedOrigins: project.allowedOrigins });
  }

  if (await repository.getIntegrationForProject(workspaceId, projectId)) {
    return reply({ ok: false, error: "ALREADY_CONNECTED" }, 409);
  }
  const [owner = "", repo = ""] = body.data.repository.split("/");
  let installation: RepositoryInstallation | undefined;
  try {
    installation = await deps.lookupInstallation(owner, repo);
  } catch (error) {
    const misconfigured =
      error instanceof GithubError && error.code === "GITHUB_MISCONFIGURED";
    return reply(
      {
        ok: false,
        error: misconfigured ? "GITHUB_NOT_CONFIGURED" : "GITHUB_UNAVAILABLE",
      },
      503,
    );
  }
  if (!installation) {
    const installUrl = await deps.appInstallUrl();
    return reply(
      {
        ok: false,
        error: "APP_NOT_INSTALLED",
        ...(installUrl ? { installUrl } : {}),
      },
      422,
    );
  }
  try {
    await repository.connectGitHubRepository({
      workspaceId,
      projectId,
      installationId: BigInt(installation.installationId),
      repositoryId: BigInt(installation.repositoryId),
      repositoryOwner: installation.owner,
      repositoryName: installation.repo,
    });
  } catch (error) {
    // A concurrent connect won the one-connection-per-project constraint.
    if (await repository.getIntegrationForProject(workspaceId, projectId)) {
      return reply({ ok: false, error: "ALREADY_CONNECTED" }, 409);
    }
    throw error;
  }
  return reply({
    ok: true,
    repository: `${installation.owner}/${installation.repo}`,
  });
}

function appCredentials() {
  const appId = process.env.GITHUB_APP_ID;
  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY;
  return {
    appId: appId ?? "",
    privateKey: rawKey ? rawKey.replace(/\\n/g, "\n") : "",
  };
}

/**
 * Deterministic stand-in for the GitHub App under the documented
 * non-production mock hook: repositories named `not-installed*` report no
 * installation; others get IDs derived from their name.
 */
function mockLookup(owner: string, repo: string) {
  if (repo.toLowerCase().startsWith("not-installed")) return undefined;
  const digest = createHash("sha256")
    .update(`${owner}/${repo}`.toLowerCase())
    .digest();
  return {
    installationId: "1",
    repositoryId: String(digest.readUInt32BE(0) + 1_000_000_000),
    owner: owner.toLowerCase(),
    repo: repo.toLowerCase(),
  };
}

export function liveProjectSettingsDependencies(): ProjectSettingsDependencies {
  const mock = usesMockEscalation();
  return {
    scope: (request, projectId) =>
      requireTicketScope(request, projectId, { requireOwner: true }),
    lookupInstallation: async (owner, repo) =>
      mock
        ? mockLookup(owner, repo)
        : lookupRepositoryInstallation(appCredentials(), { owner, repo }),
    appInstallUrl: async () =>
      mock
        ? "https://github.com/apps/issuerelay-mock/installations/new"
        : fetchAppInstallUrl(appCredentials()),
  };
}
