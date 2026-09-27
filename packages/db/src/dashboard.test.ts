import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { loadRootEnv, requireSafeTestDatabaseUrl } from "./env";
import { generatePublicProjectKey } from "./inputs";
import { createSupportRepository } from "./repository";
import { users } from "./schema";

loadRootEnv();
const { db, pool } = createDatabase(requireSafeTestDatabaseUrl());
const repository = createSupportRepository(db);

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
});

beforeEach(async () => {
  await db.execute(sql`
    TRUNCATE TABLE ticket_overrides, workspace_members, "user", "session",
      "account", verification, webhook_events, github_issues,
      github_integrations, ticket_events, ticket_classifications, tickets,
      messages, conversations, projects, workspaces,
      submission_rate_limits RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await pool.end();
});

async function setupOwner() {
  const [user] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      name: "Owner",
      email: `owner-${randomUUID()}@example.com`,
    })
    .returning();
  if (!user) throw new Error("User insert failed");
  const workspace = await repository.createWorkspace("Dashboard workspace");
  await repository.createWorkspaceMember({
    workspaceId: workspace.id,
    userId: user.id,
    role: "owner",
  });
  const project = await repository.createProject({
    workspaceId: workspace.id,
    name: "Dashboard project",
    slug: "dashboard-project",
    publicKey: generatePublicProjectKey(),
  });
  return { user, workspace, project };
}

async function submit(
  projectId: string,
  message: string,
  categoryHint: "question" | "bug" | "feature_request" = "bug",
) {
  return repository.createSubmission({
    projectId,
    message,
    categoryHint,
    submissionKey: randomUUID(),
    requestFingerprint: createHash("sha256").update(message).digest("hex"),
  });
}

async function classify(
  workspaceId: string,
  projectId: string,
  ticketId: string,
  overrides: Record<string, unknown> = {},
) {
  return repository.appendClassification(workspaceId, {
    projectId,
    ticketId,
    type: "bug",
    severity: "medium",
    route: "engineering",
    githubIssueRecommended: true,
    confidence: 0.94,
    source: "fixture",
    ...overrides,
  });
}

describe("dashboard queries", () => {
  it("scopes workspaces, projects, and counts to members", async () => {
    const { user, workspace, project } = await setupOwner();
    await submit(project.id, "The export button downloads an empty file.");
    const memberships = await repository.listWorkspacesForUser(user.id);
    expect(memberships).toMatchObject([{ role: "owner" }]);
    expect(memberships[0]?.workspace.id).toBe(workspace.id);
    expect(await repository.listWorkspacesForUser(randomUUID())).toEqual([]);
    expect(
      await repository.listProjectsForWorkspace(workspace.id),
    ).toHaveLength(1);
    expect(
      await repository.getTicketStatusCounts(workspace.id, project.id),
    ).toMatchObject([{ status: "needs_triage", count: 1 }]);
    expect(await repository.getProjectWorkspace(project.id)).toMatchObject({
      workspaceId: workspace.id,
    });
    expect(await repository.getProjectWorkspace(randomUUID())).toBeUndefined();
  });

  it("lists tickets with filters, pagination, and latest classifications", async () => {
    const { workspace, project } = await setupOwner();
    const bug = await submit(
      project.id,
      "The export button downloads an empty file.",
    );
    const question = await submit(
      project.id,
      "What technologies did you use to build this website?",
      "question",
    );
    await classify(workspace.id, project.id, bug.id);
    await classify(workspace.id, project.id, bug.id, {
      type: "question",
      severity: "low",
      route: "support",
      githubIssueRecommended: false,
      confidence: 0.93,
    });
    await classify(workspace.id, project.id, question.id, {
      type: "question",
      severity: "low",
      route: "support",
      githubIssueRecommended: false,
      confidence: 0.97,
    });

    const all = await repository.listTicketsForDashboard(
      workspace.id,
      project.id,
      {},
      { limit: 20, offset: 0 },
    );
    expect(all.total).toBe(2);
    // Latest attempt per ticket decides filter matches.
    const bugs = await repository.listTicketsForDashboard(
      workspace.id,
      project.id,
      { types: ["bug"] },
      { limit: 20, offset: 0 },
    );
    expect(bugs.total).toBe(0);
    const questions = await repository.listTicketsForDashboard(
      workspace.id,
      project.id,
      { types: ["question"], routes: ["support"] },
      { limit: 20, offset: 0 },
    );
    expect(questions.total).toBe(2);
    const reference = await repository.listTicketsForDashboard(
      workspace.id,
      project.id,
      { ticketNumber: question.ticketNumber },
      { limit: 20, offset: 0 },
    );
    expect(reference.rows.map((row) => row.ticket.id)).toEqual([question.id]);
    const page = await repository.listTicketsForDashboard(
      workspace.id,
      project.id,
      {},
      { limit: 1, offset: 1 },
    );
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(all.rows[0]?.classification?.type).toBe("question");
  });

  it("orders classification history newest first", async () => {
    const { workspace, project } = await setupOwner();
    const ticket = await submit(
      project.id,
      "The export button downloads an empty file.",
    );
    await classify(workspace.id, project.id, ticket.id);
    await classify(workspace.id, project.id, ticket.id, {
      type: "question",
      confidence: 0.93,
    });
    const history = await repository.listClassificationsForTicket(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(history.map((row) => row.type)).toEqual(["question", "bug"]);
    expect(
      await repository.listClassificationsForTicket(
        workspace.id,
        project.id,
        randomUUID(),
      ),
    ).toEqual([]);
  });

  it("records overrides separately with author, workflow state, and event", async () => {
    const { user, workspace, project } = await setupOwner();
    const ticket = await submit(
      project.id,
      "The export button downloads an empty file.",
    );
    await classify(workspace.id, project.id, ticket.id);
    const override = await repository.recordTicketOverride(
      workspace.id,
      {
        projectId: project.id,
        ticketId: ticket.id,
        decidedBy: user.id,
        route: "support",
        githubIssueRecommended: false,
        reason: "Documentation question, not a defect.",
      },
      "rerouted",
    );
    expect(override.route).toBe("support");
    expect(
      await repository.getTicketForProject(workspace.id, project.id, ticket.id),
    ).toMatchObject({ route: "support", status: "queued" });
    const latest = await repository.getLatestOverride(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(latest?.override.reason).toBe(
      "Documentation question, not a defect.",
    );
    expect(latest?.authorEmail).toBe(user.email);
    // AI history is untouched.
    const history = await repository.listClassificationsForTicket(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ type: "bug", route: "engineering" });
    const events = await repository.listTicketEvents(project.id, ticket.id);
    expect(events.map((event) => event.type)).toContain("rerouted");
    await expect(
      repository.recordTicketOverride(
        workspace.id,
        {
          projectId: project.id,
          ticketId: ticket.id,
          decidedBy: user.id,
          reason: "Empty decision.",
        },
        "rerouted",
      ),
    ).rejects.toThrow();
  });

  it("moves tickets through resolve and reopen with events", async () => {
    const { workspace, project } = await setupOwner();
    const ticket = await submit(
      project.id,
      "What technologies did you use to build this website?",
      "question",
    );
    await repository.updateTicketStatus(workspace.id, {
      projectId: project.id,
      ticketId: ticket.id,
      status: "resolved",
      eventType: "resolved",
    });
    expect(
      (
        await repository.getTicketForProject(
          workspace.id,
          project.id,
          ticket.id,
        )
      )?.status,
    ).toBe("resolved");
    await repository.updateTicketStatus(workspace.id, {
      projectId: project.id,
      ticketId: ticket.id,
      status: "queued",
      eventType: "reopened",
    });
    const events = await repository.listTicketEvents(project.id, ticket.id);
    expect(events.map((event) => event.type)).toEqual([
      "submitted",
      "resolved",
      "reopened",
    ]);
    await expect(
      repository.updateTicketStatus(workspace.id, {
        projectId: project.id,
        ticketId: randomUUID(),
        status: "resolved",
        eventType: "resolved",
      }),
    ).rejects.toThrow("not found");
  });

  it("isolates dashboard reads and writes across workspaces", async () => {
    const first = await setupOwner();
    const second = await setupOwner();
    const ticket = await submit(
      first.project.id,
      "The export button downloads an empty file.",
    );
    expect(
      await repository.listTicketsForDashboard(
        second.workspace.id,
        first.project.id,
        {},
        { limit: 20, offset: 0 },
      ),
    ).toEqual({ total: 0, rows: [] });
    expect(
      await repository.getTicketForProject(
        second.workspace.id,
        first.project.id,
        ticket.id,
      ),
    ).toBeUndefined();
    expect(
      await repository.getLatestOverride(
        second.workspace.id,
        first.project.id,
        ticket.id,
      ),
    ).toBeUndefined();
    await expect(
      repository.recordTicketOverride(
        second.workspace.id,
        {
          projectId: first.project.id,
          ticketId: ticket.id,
          decidedBy: second.user.id,
          route: "support",
          reason: "Cross-tenant attempt.",
        },
        "rerouted",
      ),
    ).rejects.toThrow("not found");
  });
});
