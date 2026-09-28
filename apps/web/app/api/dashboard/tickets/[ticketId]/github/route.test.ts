// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "20000000-0000-4000-8000-000000000001";
const WORKSPACE_ID = "10000000-0000-4000-8000-000000000001";
const TICKET_ID = "30000000-0000-4000-8000-000000000001";

const repository = {
  getIntegrationForProject: vi.fn(async () => ({
    id: "80000000-0000-4000-8000-000000000001",
    installationId: 10n,
    repositoryId: 20n,
    repositoryOwner: "demo",
    repositoryName: "disposable",
    status: "active",
  })),
  getGitHubIssueForTicket: vi.fn(
    async (): Promise<
      | { status: string; issueNumber: number | null; url: string | null }
      | undefined
    > => undefined,
  ),
  claimGitHubIssueCreation: vi.fn(async () => ({
    claimed: true as const,
    previousStatus: "needs_reconciliation",
    marker: "<!-- ai-support-ticket:SUP-7:00000000000000000000000000000000 -->",
  })),
  markGitHubIssueStatus: vi.fn(async () => ({})),
  recordTicketEvent: vi.fn(async () => ({})),
  reserveGitHubIssue: vi.fn(async () => ({})),
  getTicketForProject: vi.fn(async () => ({
    id: TICKET_ID,
    projectId: PROJECT_ID,
    conversationId: "40000000-0000-4000-8000-000000000001",
    ticketNumber: 7,
    status: "queued",
    route: "engineering",
    createdAt: new Date("2026-09-28T00:00:00.000Z"),
  })),
  getTicketSubmissionText: vi.fn(async () => ({
    message: "The projects section is blank in Safari dark mode.",
    categoryHint: "bug",
  })),
  getCurrentClassificationForProject: vi.fn(async () => ({
    type: "bug",
    severity: "medium",
    confidence: 0.95,
    route: "engineering",
    githubIssueRecommended: true,
    source: "model",
  })),
  getLatestOverride: vi.fn(async () => undefined),
  getConversationContact: vi.fn(async () => ({
    visitorName: null,
    visitorEmail: null,
  })),
};

vi.mock("../../../../../../lib/support-runtime", () => ({
  getSupportRepository: () => repository,
}));
vi.mock("../../../../../../lib/dashboard-api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../../../lib/dashboard-api")
  >()),
  requireTicketScope: async () => ({
    userId: "owner",
    access: { workspaceId: WORKSPACE_ID, workspaceName: "W", role: "owner" },
    repository,
  }),
}));

const { POST } = await import("./route");

function call(action: "preview" | "create") {
  return POST(
    new Request(`http://test/api/dashboard/tickets/${TICKET_ID}/github`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: PROJECT_ID, action }),
    }),
    { params: Promise.resolve({ ticketId: TICKET_ID }) },
  );
}

beforeEach(() => {
  vi.stubEnv("GITHUB_ESCALATION_MOCK", "");
  vi.stubEnv("GITHUB_APP_ID", "");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dashboard GitHub route without App credentials", () => {
  it("still previews: the preview never touches GitHub", async () => {
    const response = await call("preview");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview).toMatchObject({
      state: "eligible",
      repository: { owner: "demo", repo: "disposable" },
    });
  });

  it("fails closed on create before any reservation", async () => {
    const response = await call("create");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "GITHUB_MISCONFIGURED",
    });
  });
});

describe("dashboard GitHub route reconciliation", () => {
  it("runs the reconcile-only check for an unknown outcome instead of returning the preview", async () => {
    vi.stubEnv("GITHUB_ESCALATION_MOCK", "1");
    repository.getGitHubIssueForTicket.mockResolvedValue({
      status: "needs_reconciliation",
      issueNumber: null,
      url: null,
    });
    const response = await call("create");
    expect(repository.claimGitHubIssueCreation).toHaveBeenCalledTimes(1);
    // The mock finds no trusted issue, so the outcome stays unknown and
    // nothing is created.
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false,
      error: "GITHUB_CREATION_UNKNOWN",
    });
    expect(repository.markGitHubIssueStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "needs_reconciliation" }),
    );
  });
});
