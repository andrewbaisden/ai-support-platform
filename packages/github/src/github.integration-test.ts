import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createDatabase,
  createSupportRepository,
  generatePublicProjectKey,
  loadRootEnv,
  requireSafeTestDatabaseUrl,
  ticketReference,
  users,
} from "@ai-support-platform/db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMockTrackerFactory,
  ESCALATION_EVENTS,
  type EscalationRepository,
  type EscalationTicket,
  escalateTicketToGitHub,
  webhookTransactionFromScope,
} from "./index";

loadRootEnv();
const { db, pool } = createDatabase(requireSafeTestDatabaseUrl());
const support = createSupportRepository(db);

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL("../../db/migrations", import.meta.url),
    ),
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

const port: EscalationRepository = {
  getIntegration: async (workspaceId, projectId) => {
    const row = await support.getIntegrationForProject(workspaceId, projectId);
    return row
      ? {
          installationId: row.installationId.toString(),
          repositoryId: row.repositoryId.toString(),
          repositoryOwner: row.repositoryOwner,
          repositoryName: row.repositoryName,
          status: row.status,
        }
      : undefined;
  },
  getIssueLink: async (workspaceId, projectId, ticketId) => {
    const row = await support.getGitHubIssueForTicket(
      workspaceId,
      projectId,
      ticketId,
    );
    return row
      ? { status: row.status, issueNumber: row.issueNumber, url: row.url }
      : undefined;
  },
  reserveIssueLink: async (input) => {
    const integration = await port.getIntegration(
      input.workspaceId,
      input.projectId,
    );
    if (!integration) throw new Error("Integration missing for reservation");
    const existing = await support.getGitHubIssueForTicket(
      input.workspaceId,
      input.projectId,
      input.ticketId,
    );
    if (existing) return;
    const row = await support.getIntegrationForProject(
      input.workspaceId,
      input.projectId,
    );
    if (!row) throw new Error("Integration missing for reservation");
    try {
      await support.reserveGitHubIssue({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        ticketId: input.ticketId,
        integrationId: row.id,
        repositoryId: BigInt(integration.repositoryId),
        reconciliationMarker: input.reconciliationMarker,
      });
    } catch {
      const retry = await support.getGitHubIssueForTicket(
        input.workspaceId,
        input.projectId,
        input.ticketId,
      );
      if (retry) return;
      throw new Error("Reservation conflict without existing link");
    }
  },
  claimIssueCreation: (input) => support.claimGitHubIssueCreation(input),
  confirmIssueLink: async (input) => {
    await support.confirmGitHubIssue({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      ticketId: input.ticketId,
      githubIssueId: input.githubIssueId,
      issueNumber: input.issueNumber,
      url: input.url,
    });
  },
  markIssueStatus: async (input) => {
    await support.markGitHubIssueStatus(input);
  },
  recordEvent: async (input) => {
    await support.recordTicketEvent({
      projectId: input.projectId,
      ticketId: input.ticketId,
      type: input.type,
      ...(input.summary ? { summary: input.summary } : {}),
    });
  },
  withIssueScope: (process) =>
    support.withGitHubIssueSync((scope) =>
      process(webhookTransactionFromScope(scope)),
    ),
};

async function setupProject() {
  const workspace = await support.createWorkspace("Escalation workspace");
  const project = await support.createProject({
    workspaceId: workspace.id,
    name: "Escalation project",
    slug: "escalation-project",
    publicKey: generatePublicProjectKey(),
  });
  await support.connectGitHubRepository({
    workspaceId: workspace.id,
    projectId: project.id,
    installationId: 10n,
    repositoryId: 20n,
    repositoryOwner: "demo",
    repositoryName: "disposable",
  });
  return { workspace, project };
}

async function submitBug(
  workspaceId: string,
  projectId: string,
  message?: string,
) {
  const text =
    message ?? "The export page is blank and shows an error on submit.";
  const ticket = await support.createSubmission({
    projectId,
    message: text,
    categoryHint: "bug",
    submissionKey: randomUUID(),
    requestFingerprint: createHash("sha256").update(text).digest("hex"),
  });
  await support.appendClassification(workspaceId, {
    projectId,
    ticketId: ticket.id,
    type: "bug",
    severity: "medium",
    route: "engineering",
    githubIssueRecommended: true,
    confidence: 0.94,
    source: "model",
    provider: "test",
    model: "test-model",
  });
  return ticket;
}

async function escalationInput(
  workspaceId: string,
  ticket: { id: string; projectId: string },
): Promise<EscalationTicket> {
  const full = await support.getTicketForProject(
    workspaceId,
    ticket.projectId,
    ticket.id,
  );
  const submission = await support.getTicketSubmissionText(
    ticket.projectId,
    ticket.id,
  );
  const classification = await support.getCurrentClassificationForProject(
    workspaceId,
    ticket.projectId,
    ticket.id,
  );
  const override = await support.getLatestOverride(
    workspaceId,
    ticket.projectId,
    ticket.id,
  );
  if (!full || !submission || !classification) {
    throw new Error("Fixture ticket incomplete");
  }
  const contact = await support.getConversationContact(
    ticket.projectId,
    full.conversationId,
  );
  return {
    ticketId: full.id,
    projectId: full.projectId,
    workspaceId,
    ticketNumber: full.ticketNumber,
    ticketReference: ticketReference(full.ticketNumber),
    status: full.status,
    route: full.route,
    reportedAt: full.createdAt,
    message: submission.message,
    categoryHint: submission.categoryHint,
    contact: contact
      ? { name: contact.visitorName, email: contact.visitorEmail }
      : null,
    classification: {
      type: classification.type,
      severity: classification.severity,
      confidence: classification.confidence,
      route: classification.route,
      githubIssueRecommended: classification.githubIssueRecommended,
      source: classification.source,
    },
    override: override?.effective
      ? {
          route: override.effective.route,
          githubIssueRecommended: override.effective.githubIssueRecommended,
        }
      : null,
  };
}

describe("escalation persistence", () => {
  it("links one issue, records events, and keeps ticket state", async () => {
    const { workspace, project } = await setupProject();
    const ticket = await submitBug(workspace.id, project.id);
    const factory = createMockTrackerFactory();
    const outcome = await escalateTicketToGitHub({
      repository: port,
      trackers: factory,
      ticket: await escalationInput(workspace.id, ticket),
    });
    expect(outcome.outcome).toBe("created");
    expect(factory.created).toHaveLength(1);
    const link = await support.getGitHubIssueForTicket(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(link?.status).toBe("open");
    expect(link?.issueNumber).toBeGreaterThan(0);
    expect(link?.url).toMatch(
      /^https:\/\/github\.com\/demo\/disposable\/issues\/\d+$/,
    );
    expect(
      await support.getTicketForProject(workspace.id, project.id, ticket.id),
    ).toMatchObject({ status: "queued", route: "engineering" });
    const events = await support.listTicketEvents(project.id, ticket.id);
    expect(events.map((event) => event.type)).toContain(
      ESCALATION_EVENTS.requested,
    );
    expect(events.map((event) => event.type)).toContain(
      ESCALATION_EVENTS.created,
    );
  });

  it("reuses the existing link on repeat escalation", async () => {
    const { workspace, project } = await setupProject();
    const ticket = await submitBug(workspace.id, project.id);
    const factory = createMockTrackerFactory();
    const input = await escalationInput(workspace.id, ticket);
    const first = await escalateTicketToGitHub({
      repository: port,
      trackers: factory,
      ticket: input,
    });
    const second = await escalateTicketToGitHub({
      repository: port,
      trackers: factory,
      ticket: input,
    });
    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("already-linked");
    expect(factory.created).toHaveLength(1);
  });

  it("allows one remote create under concurrent confirmations", async () => {
    const { workspace, project } = await setupProject();
    const ticket = await submitBug(workspace.id, project.id);
    const input = await escalationInput(workspace.id, ticket);
    const factory = createMockTrackerFactory();
    const outcomes = await Promise.all([
      escalateTicketToGitHub({
        repository: port,
        trackers: factory,
        ticket: input,
      }),
      escalateTicketToGitHub({
        repository: port,
        trackers: factory,
        ticket: input,
      }),
    ]);
    expect(factory.created).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.outcome === "created"),
    ).toHaveLength(1);
    const link = await support.getGitHubIssueForTicket(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(link?.githubIssueId).not.toBeNull();
    await expect(
      support.confirmGitHubIssue({
        workspaceId: workspace.id,
        projectId: project.id,
        ticketId: ticket.id,
        githubIssueId: 999999n,
        issueNumber: 999,
        url: "https://github.com/demo/disposable/issues/999",
      }),
    ).rejects.toThrow("already confirmed");
    expect(
      (
        await support.getGitHubIssueForTicket(
          workspace.id,
          project.id,
          ticket.id,
        )
      )?.githubIssueId,
    ).toBe(link?.githubIssueId);
  });

  it("honors a human decline and isolates other projects", async () => {
    const { workspace, project } = await setupProject();
    const otherWorkspace = await support.createWorkspace("Other workspace");
    const otherProject = await support.createProject({
      workspaceId: otherWorkspace.id,
      name: "Other project",
      slug: "other-project",
      publicKey: generatePublicProjectKey(),
    });
    const ticket = await submitBug(workspace.id, project.id);
    const [owner] = await db
      .insert(users)
      .values({
        id: randomUUID(),
        name: "Owner",
        email: `owner-${randomUUID()}@example.com`,
      })
      .returning();
    if (!owner) throw new Error("Owner insert failed");
    await support.recordTicketOverride(
      workspace.id,
      {
        projectId: project.id,
        ticketId: ticket.id,
        decidedBy: owner.id,
        githubIssueRecommended: false,
        reason: "Not reproducible, keep in the support queue.",
      },
      "rerouted",
    );
    await support.recordTicketOverride(
      workspace.id,
      {
        projectId: project.id,
        ticketId: ticket.id,
        decidedBy: owner.id,
        route: "support",
        reason: "Route report to support without changing the GitHub decision.",
      },
      "rerouted",
    );
    expect(
      (await support.getLatestOverride(workspace.id, project.id, ticket.id))
        ?.effective.githubIssueRecommended,
    ).toBe(false);
    const factory = createMockTrackerFactory();
    const declined = await escalateTicketToGitHub({
      repository: port,
      trackers: factory,
      ticket: await escalationInput(workspace.id, ticket),
    });
    expect(declined.outcome).toBe("blocked");
    expect(factory.created).toHaveLength(0);
    expect(
      await support.getGitHubIssueForTicket(
        workspace.id,
        project.id,
        ticket.id,
      ),
    ).toBeUndefined();
    const otherTicket = await submitBug(otherWorkspace.id, otherProject.id);
    const other = await escalateTicketToGitHub({
      repository: port,
      trackers: factory,
      ticket: await escalationInput(otherWorkspace.id, otherTicket),
    });
    expect(other).toEqual({ outcome: "not-configured" });
    expect(factory.created).toHaveLength(0);
  });

  it("marks timeouts unknown then reconciles", async () => {
    const { workspace, project } = await setupProject();
    const ticket = await submitBug(workspace.id, project.id);
    const input = await escalationInput(workspace.id, ticket);
    const unknown = await escalateTicketToGitHub({
      repository: port,
      trackers: createMockTrackerFactory([{ kind: "timeout" }]),
      ticket: input,
    });
    expect(unknown).toEqual({
      outcome: "unknown",
      code: "GITHUB_CREATION_UNKNOWN",
    });
    const link = await support.getGitHubIssueForTicket(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(link?.status).toBe("needs_reconciliation");
    const reconciled = await escalateTicketToGitHub({
      repository: port,
      trackers: createMockTrackerFactory([{ kind: "ambiguous-then-found" }]),
      ticket: input,
    });
    expect(reconciled.outcome).toBe("reconciled");
    expect(
      (
        await support.getGitHubIssueForTicket(
          workspace.id,
          project.id,
          ticket.id,
        )
      )?.status,
    ).toBe("open");
  });

  it("blocks privacy-sensitive reports without network calls", async () => {
    const { workspace, project } = await setupProject();
    const ticket = await submitBug(
      workspace.id,
      project.id,
      "The export page is blank; reach me at ada@example.com for details.",
    );
    const factory = createMockTrackerFactory();
    const outcome = await escalateTicketToGitHub({
      repository: port,
      trackers: factory,
      ticket: await escalationInput(workspace.id, ticket),
    });
    expect(outcome.outcome).toBe("blocked");
    expect(factory.created).toHaveLength(0);
    expect(
      await support.getGitHubIssueForTicket(
        workspace.id,
        project.id,
        ticket.id,
      ),
    ).toBeUndefined();
  });
});
