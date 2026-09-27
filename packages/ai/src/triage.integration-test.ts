import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createDatabase,
  createSupportRepository,
  generatePublicProjectKey,
  loadRootEnv,
  requireSafeTestDatabaseUrl,
} from "@ai-support-platform/db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  AiError,
  FixtureTicketClassifier,
  type TriageRepository,
  type TriageTicket,
  triageTicket,
} from "./index";

loadRootEnv();
const { db, pool } = createDatabase(requireSafeTestDatabaseUrl());
const repository = createSupportRepository(db);

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL("../../db/migrations", import.meta.url),
    ),
  });
});

beforeEach(async () => {
  await db.execute(sql`
    TRUNCATE TABLE webhook_events, github_issues, github_integrations,
      ticket_events, ticket_classifications, tickets, messages,
      conversations, projects, workspaces, submission_rate_limits
      RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await pool.end();
});

const port: TriageRepository = {
  getCurrentClassification: (input) =>
    repository
      .getCurrentClassificationForProject(
        input.workspaceId,
        input.projectId,
        input.ticketId,
      )
      .then((row) => (row ? { type: row.type, route: row.route } : undefined)),
  appendClassification: (input) =>
    repository.appendClassification(input.workspaceId, {
      projectId: input.projectId,
      ticketId: input.ticketId,
      type: input.type,
      severity: input.severity,
      route: input.route,
      githubIssueRecommended: input.githubIssueRecommended,
      confidence: input.confidence,
      source: input.source,
      provider: input.provider,
      model: input.model,
      reason: input.reason,
    }),
  recordTicketEvent: (input) =>
    repository.recordTicketEvent(input).then(() => {}),
};

async function setupProject() {
  const workspace = await repository.createWorkspace("Triage workspace");
  const project = await repository.createProject({
    workspaceId: workspace.id,
    name: "Triage project",
    slug: "triage-project",
    publicKey: generatePublicProjectKey(),
  });
  return { workspace, project };
}

async function submitTicket(
  projectId: string,
  message: string,
  categoryHint: "question" | "bug" | "feature_request" = "bug",
) {
  const ticket = await repository.createSubmission({
    projectId,
    message,
    categoryHint,
    submissionKey: randomUUID(),
    requestFingerprint: createHash("sha256").update(message).digest("hex"),
  });
  const submission = await repository.getTicketSubmissionText(
    projectId,
    ticket.id,
  );
  if (!submission) throw new Error("Submission text missing");
  return { ticket, submission };
}

function triageInput(
  workspaceId: string,
  ticket: { id: string; projectId: string },
  submission: {
    message: string;
    categoryHint?: TriageTicket["categoryHint"] | null;
  },
): TriageTicket {
  return {
    ticketId: ticket.id,
    projectId: ticket.projectId,
    workspaceId,
    status: "needs_triage",
    message: submission.message,
    ...(submission.categoryHint
      ? { categoryHint: submission.categoryHint }
      : {}),
  };
}

describe("triage persistence", () => {
  it("classifies a bug end to end: history, route, status, and event", async () => {
    const { workspace, project } = await setupProject();
    const { ticket, submission } = await submitTicket(
      project.id,
      "The projects section becomes blank in Safari after switching to dark mode.",
    );
    const outcome = await triageTicket(
      port,
      new FixtureTicketClassifier(),
      triageInput(workspace.id, ticket, submission),
    );
    expect(outcome).toMatchObject({
      outcome: "classified",
      type: "bug",
      route: "engineering",
      githubEligible: true,
    });
    const classification = await repository.getCurrentClassificationForProject(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(classification).toMatchObject({
      type: "bug",
      route: "engineering",
      source: "fixture",
      provider: "fixture",
      githubIssueRecommended: true,
    });
    expect(classification?.confidence).toBeCloseTo(0.94);
    expect(
      await repository.getTicketForProject(workspace.id, project.id, ticket.id),
    ).toMatchObject({ status: "queued", route: "engineering" });
    expect(
      await repository.listTicketEvents(project.id, ticket.id),
    ).toMatchObject([{ type: "submitted" }, { type: "classified" }]);
    expect(
      (await repository.getTicketSubmissionText(project.id, ticket.id))
        ?.message,
    ).toBe(submission.message);
  });

  it("preserves the visitor hint while storing a disagreeing classification", async () => {
    const { workspace, project } = await setupProject();
    const { ticket, submission } = await submitTicket(
      project.id,
      "How did you build the animated background?",
      "bug",
    );
    const outcome = await triageTicket(
      port,
      new FixtureTicketClassifier(),
      triageInput(workspace.id, ticket, submission),
    );
    expect(outcome).toMatchObject({ outcome: "classified", type: "question" });
    expect(
      (
        await repository.getTicketForProject(
          workspace.id,
          project.id,
          ticket.id,
        )
      )?.categoryHint,
    ).toBe("bug");
    expect(
      await repository.getTicketForProject(workspace.id, project.id, ticket.id),
    ).toMatchObject({ status: "queued", route: "support" });
  });

  it("quarantines spam without GitHub eligibility", async () => {
    const { workspace, project } = await setupProject();
    const { ticket, submission } = await submitTicket(
      project.id,
      "Buy cheap cryptocurrency now...",
      "question",
    );
    const outcome = await triageTicket(
      port,
      new FixtureTicketClassifier(),
      triageInput(workspace.id, ticket, submission),
    );
    expect(outcome).toMatchObject({
      outcome: "classified",
      type: "spam",
      githubEligible: false,
    });
    expect(
      await repository.getTicketForProject(workspace.id, project.id, ticket.id),
    ).toMatchObject({ status: "quarantined", route: "ignore" });
  });

  it("keeps failed tickets in needs_triage with a failure event", async () => {
    const { project } = await setupProject();
    const { ticket, submission } = await submitTicket(
      project.id,
      "The projects section becomes blank in Safari after switching to dark mode.",
    );
    const outcome = await triageTicket(
      port,
      {
        classify: async () => {
          throw new AiError("AI_PROVIDER_UNAVAILABLE", "down");
        },
      },
      {
        ...triageInput(project.workspaceId, ticket, submission),
        status: "needs_triage",
      },
    );
    expect(outcome).toEqual({
      outcome: "failed",
      code: "AI_PROVIDER_UNAVAILABLE",
    });
    expect(
      (
        await repository.getTicketForProject(
          project.workspaceId,
          project.id,
          ticket.id,
        )
      )?.status,
    ).toBe("needs_triage");
    expect(
      await repository.getCurrentClassificationForProject(
        project.workspaceId,
        project.id,
        ticket.id,
      ),
    ).toBeUndefined();
    expect(
      await repository.listTicketEvents(project.id, ticket.id),
    ).toMatchObject([{ type: "submitted" }, { type: "triage_failed" }]);
  });

  it("isolates triage between projects and converges concurrent attempts", async () => {
    const { workspace, project } = await setupProject();
    const otherWorkspace = await repository.createWorkspace("Other workspace");
    const otherProject = await repository.createProject({
      workspaceId: otherWorkspace.id,
      name: "Other project",
      slug: "other-project",
      publicKey: generatePublicProjectKey(),
    });
    const first = await submitTicket(
      project.id,
      "The projects section becomes blank in Safari after switching to dark mode.",
    );
    const second = await submitTicket(
      otherProject.id,
      "The projects section becomes blank in Safari after switching to dark mode.",
    );
    const classifier = new FixtureTicketClassifier();
    const [one, two] = await Promise.all([
      triageTicket(
        port,
        classifier,
        triageInput(workspace.id, first.ticket, first.submission),
      ),
      triageTicket(
        port,
        classifier,
        triageInput(workspace.id, first.ticket, first.submission),
      ),
    ]);
    expect([one.outcome, two.outcome]).toContain("classified");
    expect(
      await repository.getTicketForProject(
        workspace.id,
        project.id,
        first.ticket.id,
      ),
    ).toMatchObject({ status: "queued", route: "engineering" });
    // The other project's ticket is untouched.
    expect(
      (
        await repository.getTicketForProject(
          otherWorkspace.id,
          otherProject.id,
          second.ticket.id,
        )
      )?.status,
    ).toBe("needs_triage");
    expect(
      await repository.getCurrentClassificationForProject(
        otherWorkspace.id,
        otherProject.id,
        second.ticket.id,
      ),
    ).toBeUndefined();
  });

  it("lists pending tickets and resolves submission text with context", async () => {
    const { workspace, project } = await setupProject();
    const { ticket } = await submitTicket(
      project.id,
      "What technologies did you use to build this website?",
      "question",
    );
    const pending = await repository.listTicketsNeedingTriage(10);
    expect(pending).toMatchObject([
      {
        ticketId: ticket.id,
        projectId: project.id,
        workspaceId: workspace.id,
        status: "needs_triage",
      },
    ]);
    const context = await repository.findTicketContext(ticket.id);
    expect(context).toMatchObject({ ticketId: ticket.id });
    expect(
      await repository.getTicketSubmissionText(project.id, randomUUID()),
    ).toBeUndefined();
    await expect(repository.listTicketsNeedingTriage(0)).rejects.toThrow();
  });
});
