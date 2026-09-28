// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
let role: "owner" | "member" = "owner";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@ai-support-platform/auth", () => {
  class AuthRequiredError extends Error {}
  return {
    AuthRequiredError,
    requireSessionUser: async () => ({ id: "user-1" }),
    requireWorkspaceAccess: async () => ({
      workspaceId: WORKSPACE_ID,
      workspaceName: "Workspace",
      role,
    }),
  };
});
vi.mock("./support-runtime", () => ({
  getSupportRepository: () => ({
    getProjectWorkspace: async () => ({ workspaceId: WORKSPACE_ID }),
  }),
}));

const { requireTicketScope, scopeErrorResponse } = await import(
  "./dashboard-api"
);

function mutation(headers: Record<string, string>) {
  return new Request("http://127.0.0.1:3000/api/dashboard/tickets/x/status", {
    method: "POST",
    headers: { host: "127.0.0.1:3000", ...headers },
  });
}

beforeEach(() => {
  role = "owner";
});

describe("dashboard mutation scope", () => {
  it("requires a same-origin Origin header on every mutation", async () => {
    for (const headers of [
      {} as Record<string, string>,
      { origin: "null" },
      { origin: "https://evil.example" },
      { origin: "http://127.0.0.1:3001" },
      { origin: "not a url" },
    ]) {
      expect(
        await requireTicketScope(mutation(headers), PROJECT_ID),
        JSON.stringify(headers),
      ).toEqual({ error: "FORBIDDEN" });
    }
    expect(
      await requireTicketScope(
        mutation({ origin: "http://127.0.0.1:3000" }),
        PROJECT_ID,
      ),
    ).toMatchObject({ userId: "user-1", access: { role: "owner" } });
  });

  it("limits owner-only actions to workspace owners", async () => {
    role = "member";
    const request = () => mutation({ origin: "http://127.0.0.1:3000" });
    expect(await requireTicketScope(request(), PROJECT_ID)).toMatchObject({
      access: { role: "member" },
    });
    expect(
      await requireTicketScope(request(), PROJECT_ID, { requireOwner: true }),
    ).toEqual({ error: "OWNER_REQUIRED" });
  });

  it("maps scope errors to safe statuses", async () => {
    const statuses = await Promise.all(
      (
        ["UNAUTHENTICATED", "OWNER_REQUIRED", "FORBIDDEN", "NOT_FOUND"] as const
      ).map(async (error) => {
        const response = scopeErrorResponse(error);
        return [response.status, await response.json()];
      }),
    );
    expect(statuses).toEqual([
      [401, { ok: false, error: "UNAUTHENTICATED" }],
      [403, { ok: false, error: "OWNER_REQUIRED" }],
      [404, { ok: false, error: "FORBIDDEN" }],
      [404, { ok: false, error: "NOT_FOUND" }],
    ]);
  });
});
