import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  FixtureTicketClassifier,
  type TicketClassificationInput,
  type TicketClassifier,
  type TriageRepository,
  triageTicket,
} from "@ai-support-platform/ai";
import {
  createDatabase,
  createSupportRepository,
  generatePublicProjectKey,
  loadRootEnv,
  requireSafeTestDatabaseUrl,
  SubmissionConflictError,
  ticketReference,
  users,
} from "@ai-support-platform/db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMockTrackerFactory,
  type EscalationRepository,
  type EscalationTicket,
  escalateTicketToGitHub,
  markerForTicket,
  previewEscalation,
  processGitHubWebhook,
  type WebhookRepository,
} from "./index";

/**
 * Steps 5–15 of the live acceptance journey against real PostgreSQL, the
 * real triage and escalation services, and the webhook transaction. Only
 * GitHub's network is replaced by the scripted mock tracker.
 */
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

// Fully synthetic runs (fixture triage + mock tracker) may escalate fixture
// classifications, exactly as the mock-mode dashboard does.
const LOCAL_MOCK_POLICY = { allowFixtureClassifications: true };
const INSTALLATION_ID = 10;
const REPOSITORY_ID = 20;
const CONTACT = { name: "Ada Tester", email: "ada.tester@example.test" };
const SAFARI_BUG =
  "The projects section becomes blank in Safari when I switch the site to dark mode.";

const triagePort: TriageRepository = {
  getCurrentClassification: (input) =>
    support
      .getCurrentClassificationForProject(
        input.workspaceId,
        input.projectId,
        input.ticketId,
      )
      .then((row) => (row ? { type: row.type, route: row.route } : undefined)),
  appendClassification: (input) =>
    support.appendClassification(input.workspaceId, {
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
  recordTicketEvent: (input) => support.recordTicketEvent(input).then(() => {}),
};

const escalationPort: EscalationRepository = {
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
    if (
      await support.getGitHubIssueForTicket(
        input.workspaceId,
        input.projectId,
        input.ticketId,
      )
    ) {
      return;
    }
    const row = await support.getIntegrationForProject(
      input.workspaceId,
      input.projectId,
    );
    if (!row) throw new Error("Integration missing for reservation");
    await support.reserveGitHubIssue({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      ticketId: input.ticketId,
      integrationId: row.id,
      repositoryId: row.repositoryId,
      reconciliationMarker: input.reconciliationMarker,
    });
  },
  claimIssueCreation: (input) => support.claimGitHubIssueCreation(input),
  confirmIssueLink: async (input) => {
    await support.confirmGitHubIssue(input);
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
};

/** Mirrors the webhook route's port over the delivery transaction. */
const webhookPort: WebhookRepository = {
  withDelivery: (delivery, process) =>
    support.withGitHubWebhookDelivery(
      {
        deliveryId: delivery.deliveryId,
        eventType: delivery.eventType,
        ...(delivery.action ? { action: delivery.action } : {}),
        ...(delivery.repositoryId
          ? { repositoryId: BigInt(delivery.repositoryId) }
          : {}),
        ...(delivery.installationId
          ? { installationId: BigInt(delivery.installationId) }
          : {}),
        ...(delivery.githubIssueId
          ? { githubIssueId: BigInt(delivery.githubIssueId) }
          : {}),
      },
      (scope) =>
        process({
          findLink: async (ref) => {
            const row = await scope.findLink({
              repositoryId: BigInt(ref.repositoryId),
              githubIssueId: BigInt(ref.githubIssueId),
            });
            return row
              ? {
                  ticketId: row.ticketId,
                  projectId: row.projectId,
                  workspaceId: row.workspaceId,
                  issueNumber: row.issueNumber,
                  installationId: row.installationId.toString(),
                  integrationStatus: row.integrationStatus,
                  linkStatus: row.linkStatus,
                  ticketStatus: row.ticketStatus,
                  ticketRoute: row.ticketRoute,
                  ...(row.latestStatusEvent
                    ? { latestStatusEvent: row.latestStatusEvent }
                    : {}),
                }
              : undefined;
          },
          setIssueState: async (link, state) => {
            const row = await scope.findLink({
              repositoryId: BigInt(delivery.repositoryId ?? "0"),
              githubIssueId: BigInt(delivery.githubIssueId ?? "0"),
            });
            if (!row || row.ticketId !== link.ticketId)
              throw new Error("Webhook link changed");
            await scope.setIssueState(row.issueId, state);
          },
          setTicketStatus: (link, status, eventType, summary) =>
            scope.setTicketStatus(link.ticketId, status, eventType, summary),
          recordEvent: (link, type, summary) =>
            scope.recordEvent(link.projectId, link.ticketId, type, summary),
        }),
    ),
};

function issueEvent(
  action: "closed" | "reopened",
  issue: { id: number; number: number },
  overrides: {
    deliveryId?: string;
    repositoryId?: number;
    installationId?: number;
    issueNumber?: number;
  } = {},
) {
  const repositoryId = String(overrides.repositoryId ?? REPOSITORY_ID);
  const installationId = String(overrides.installationId ?? INSTALLATION_ID);
  return processGitHubWebhook(webhookPort, {
    delivery: {
      deliveryId: overrides.deliveryId ?? randomUUID(),
      eventType: "issues",
      action,
      repositoryId,
      installationId,
      githubIssueId: String(issue.id),
    },
    action,
    installationId,
    issue: {
      repositoryId,
      githubIssueId: String(issue.id),
      issueNumber: overrides.issueNumber ?? issue.number,
      issueState: action === "closed" ? "closed" : "open",
    },
  });
}

async function setupProject(slug = "journey") {
  const workspace = await support.createWorkspace(`Workspace ${slug}`);
  const project = await support.createProject({
    workspaceId: workspace.id,
    name: `Project ${slug}`,
    slug,
    publicKey: generatePublicProjectKey(),
  });
  const integration = await support.connectGitHubRepository({
    workspaceId: workspace.id,
    projectId: project.id,
    installationId: BigInt(INSTALLATION_ID),
    repositoryId: BigInt(REPOSITORY_ID),
    repositoryOwner: "demo",
    repositoryName: "disposable",
  });
  return { workspace, project, integration };
}

function fingerprint(parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

async function submit(
  projectId: string,
  message: string,
  options: {
    submissionKey?: string;
    categoryHint?: "question" | "bug" | "feature_request";
    contact?: { name: string; email: string };
  } = {},
) {
  const categoryHint = options.categoryHint ?? "bug";
  return support.createSubmission({
    projectId,
    message,
    categoryHint,
    submissionKey: options.submissionKey ?? randomUUID(),
    requestFingerprint: fingerprint([
      1,
      categoryHint,
      message,
      options.contact?.name ?? "",
      options.contact?.email ?? "",
    ]),
    ...(options.contact
      ? {
          visitorName: options.contact.name,
          visitorEmail: options.contact.email,
        }
      : {}),
  });
}

/** Records every classifier input so the test can prove what left the platform. */
function recordingClassifier(
  inner: TicketClassifier = new FixtureTicketClassifier(),
) {
  const inputs: TicketClassificationInput[] = [];
  const classifier: TicketClassifier = {
    classify: async (input) => {
      inputs.push(structuredClone(input));
      return inner.classify(input);
    },
  };
  return { classifier, inputs };
}

async function triage(
  workspaceId: string,
  ticket: { id: string; projectId: string },
  classifier: TicketClassifier,
) {
  const submission = await support.getTicketSubmissionText(
    ticket.projectId,
    ticket.id,
  );
  if (!submission) throw new Error("Submission text missing");
  return triageTicket(triagePort, classifier, {
    ticketId: ticket.id,
    projectId: ticket.projectId,
    workspaceId,
    status: "needs_triage",
    message: submission.message,
    ...(submission.categoryHint
      ? { categoryHint: submission.categoryHint }
      : {}),
  });
}

/** Loads escalation input the way the dashboard route does. */
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
  if (!full || !submission) throw new Error("Fixture ticket incomplete");
  const [classification, override, contact] = await Promise.all([
    support.getCurrentClassificationForProject(
      workspaceId,
      ticket.projectId,
      ticket.id,
    ),
    support.getLatestOverride(workspaceId, ticket.projectId, ticket.id),
    support.getConversationContact(ticket.projectId, full.conversationId),
  ]);
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
    classification: classification
      ? {
          type: classification.type,
          severity: classification.severity,
          confidence: classification.confidence,
          route: classification.route,
          githubIssueRecommended: classification.githubIssueRecommended,
          source: classification.source,
        }
      : null,
    override: override?.effective
      ? {
          route: override.effective.route,
          githubIssueRecommended: override.effective.githubIssueRecommended,
        }
      : null,
  };
}

async function previewFor(workspaceId: string, ticket: EscalationTicket) {
  const [integration, link] = await Promise.all([
    support.getIntegrationForProject(workspaceId, ticket.projectId),
    support.getGitHubIssueForTicket(
      workspaceId,
      ticket.projectId,
      ticket.ticketId,
    ),
  ]);
  return previewEscalation({
    ticket,
    integration: integration
      ? {
          repositoryOwner: integration.repositoryOwner,
          repositoryName: integration.repositoryName,
          status: integration.status,
        }
      : undefined,
    link: link
      ? { status: link.status, issueNumber: link.issueNumber, url: link.url }
      : undefined,
    allowFixtureClassifications: LOCAL_MOCK_POLICY.allowFixtureClassifications,
  });
}

async function eventTypes(projectId: string, ticketId: string) {
  return (await support.listTicketEvents(projectId, ticketId)).map(
    (event) => event.type,
  );
}

async function count(table: "conversations" | "messages" | "tickets") {
  const result = await db.execute(
    sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`,
  );
  return (result.rows[0] as { n: number }).n;
}

async function createOwner() {
  const [owner] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      name: "Journey owner",
      email: `owner-${randomUUID()}@example.test`,
    })
    .returning();
  if (!owner) throw new Error("Owner insert failed");
  return owner;
}

/** Submission → triage → confirmed mock creation, as the operator flow does it. */
async function linkedBug(slug = "linked") {
  const { workspace, project, integration } = await setupProject(slug);
  const ticket = await submit(project.id, SAFARI_BUG, { contact: CONTACT });
  await triage(workspace.id, ticket, new FixtureTicketClassifier());
  const factory = createMockTrackerFactory();
  const outcome = await escalateTicketToGitHub({
    policy: LOCAL_MOCK_POLICY,
    repository: escalationPort,
    trackers: factory,
    ticket: await escalationInput(workspace.id, ticket),
  });
  if (outcome.outcome !== "created") throw new Error("Fixture not linked");
  return {
    workspace,
    project,
    integration,
    ticket,
    factory,
    issue: outcome.issue,
  };
}

describe("live journey steps 5–15 against PostgreSQL", () => {
  it("carries one bug from submission to GitHub close and reopen with a complete audit trail", async () => {
    const { workspace, project, integration } = await setupProject();

    // Step 5: one logical submission, contact private to the conversation.
    const submissionKey = randomUUID();
    const ticket = await submit(project.id, SAFARI_BUG, {
      submissionKey,
      contact: CONTACT,
    });
    const retried = await submit(project.id, SAFARI_BUG, {
      submissionKey,
      contact: CONTACT,
    });
    expect(retried.id).toBe(ticket.id);
    await expect(
      submit(project.id, `${SAFARI_BUG} Also on iPad.`, {
        submissionKey,
        contact: CONTACT,
      }),
    ).rejects.toBeInstanceOf(SubmissionConflictError);
    expect(await count("conversations")).toBe(1);
    expect(await count("messages")).toBe(1);
    expect(await count("tickets")).toBe(1);
    expect(ticket).toMatchObject({
      status: "needs_triage",
      route: null,
      categoryHint: "bug",
    });
    expect(
      await support.getConversationContact(project.id, ticket.conversationId),
    ).toEqual({ visitorName: CONTACT.name, visitorEmail: CONTACT.email });
    expect(await eventTypes(project.id, ticket.id)).toEqual(["submitted"]);

    // Step 6: real triage service; the classifier sees message + hint only.
    const { classifier, inputs } = recordingClassifier();
    const triaged = await triage(workspace.id, ticket, classifier);
    expect(triaged).toMatchObject({
      outcome: "classified",
      type: "bug",
      route: "engineering",
      githubEligible: true,
    });
    expect(inputs).toEqual([{ message: SAFARI_BUG, categoryHint: "bug" }]);
    expect(JSON.stringify(inputs)).not.toContain(CONTACT.email);
    expect(JSON.stringify(inputs)).not.toContain(CONTACT.name);
    const history = await support.listClassificationsForTicket(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      type: "bug",
      route: "engineering",
      severity: "high",
      confidence: 0.94,
      githubIssueRecommended: true,
      source: "fixture",
      provider: "fixture",
      model: "fixture-v1",
    });
    const afterTriage = await support.getTicketForProject(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(afterTriage).toMatchObject({
      status: "queued",
      route: "engineering",
      categoryHint: "bug",
    });
    expect(
      await support.getGitHubIssueForTicket(
        workspace.id,
        project.id,
        ticket.id,
      ),
    ).toBeUndefined();

    // Step 7: preview targets the connected repository and has no side effects.
    const input = await escalationInput(workspace.id, ticket);
    const eventsBeforePreview = await eventTypes(project.id, ticket.id);
    const preview = await previewFor(workspace.id, input);
    if (preview.state !== "eligible") throw new Error(preview.state);
    expect(preview.repository).toEqual({ owner: "demo", repo: "disposable" });
    const reference = ticketReference(ticket.ticketNumber);
    expect(preview.draft.title).toBe(
      `[${reference}] Reported bug: The projects section becomes blank in Safari when I switch the site to dark mod…`,
    );
    expect(preview.draft.title.length).toBeLessThanOrEqual(
      `[${reference}] Reported bug: `.length + 80,
    );
    expect(preview.draft.body).toContain("## Report");
    expect(preview.draft.body).toContain(
      "model score 0.94 — not a calibrated probability",
    );
    expect(preview.candidateLabels).toEqual(["bug", "severity:high"]);
    expect(await eventTypes(project.id, ticket.id)).toEqual(
      eventsBeforePreview,
    );
    expect(
      await support.getGitHubIssueForTicket(
        workspace.id,
        project.id,
        ticket.id,
      ),
    ).toBeUndefined();

    // Step 8: explicit confirmation creates exactly one issue and links it.
    const factory = createMockTrackerFactory();
    const created = await escalateTicketToGitHub({
      policy: LOCAL_MOCK_POLICY,
      repository: escalationPort,
      trackers: factory,
      ticket: input,
    });
    if (created.outcome !== "created") throw new Error(created.outcome);
    expect(factory.created).toHaveLength(1);
    const link = await support.getGitHubIssueForTicket(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(link).toMatchObject({
      status: "open",
      issueNumber: created.issue.number,
      githubIssueId: BigInt(created.issue.id),
      repositoryId: BigInt(REPOSITORY_ID),
      integrationId: integration.id,
      url: `https://github.com/demo/disposable/issues/${created.issue.number}`,
    });
    expect(
      (await support.getTicketForProject(workspace.id, project.id, ticket.id))
        ?.status,
    ).toBe("queued");
    const repeat = await escalateTicketToGitHub({
      policy: LOCAL_MOCK_POLICY,
      repository: escalationPort,
      trackers: factory,
      ticket: await escalationInput(workspace.id, ticket),
    });
    expect(repeat).toEqual({
      outcome: "already-linked",
      issue: { number: created.issue.number, url: created.issue.url },
    });
    expect(factory.created).toHaveLength(1);

    // Step 9: the published projection carries no private or internal data.
    const published = factory.created[0];
    if (!published) throw new Error("No published issue");
    const publicText = `${published.title}\n${published.body}\n${published.labels.join(",")}`;
    for (const privateValue of [
      CONTACT.name,
      CONTACT.email,
      "example.test",
      ticket.id,
      ticket.conversationId,
      project.id,
      workspace.id,
      integration.id,
      project.publicKey,
      submissionKey,
    ]) {
      expect(publicText).not.toContain(privateValue);
    }
    expect(published.body).toContain(SAFARI_BUG);

    // Step 10: an opaque marker ties both sides together.
    const marker = markerForTicket(reference, ticket.id);
    expect(marker).toMatch(
      new RegExp(`^<!-- ai-support-ticket:${reference}:[0-9a-f]{32} -->$`),
    );
    expect(marker).toBe(markerForTicket(reference, ticket.id));
    expect(
      published.body.split("\n").filter((line) => line === marker),
    ).toHaveLength(1);
    expect(link?.reconciliationMarker).toBe(marker);

    // Step 11: forged identities never touch the linked ticket.
    const issue = created.issue;
    expect(await issueEvent("closed", issue, { repositoryId: 21 })).toEqual({
      outcome: "ignored",
      reason: "unknown_issue",
    });
    expect(await issueEvent("closed", issue, { installationId: 11 })).toEqual({
      outcome: "ignored",
      reason: "identity_mismatch",
    });
    expect(
      await issueEvent("closed", issue, { issueNumber: issue.number + 1 }),
    ).toEqual({ outcome: "ignored", reason: "identity_mismatch" });
    expect(
      await issueEvent("closed", { id: issue.id + 1, number: issue.number }),
    ).toEqual({ outcome: "ignored", reason: "unknown_issue" });
    expect(
      (
        await support.getGitHubIssueForTicket(
          workspace.id,
          project.id,
          ticket.id,
        )
      )?.status,
    ).toBe("open");

    // Step 12: a genuine close resolves the ticket exactly once.
    const closeDelivery = randomUUID();
    expect(
      await issueEvent("closed", issue, { deliveryId: closeDelivery }),
    ).toEqual({ outcome: "processed", detail: "closed" });
    expect(
      await issueEvent("closed", issue, { deliveryId: closeDelivery }),
    ).toEqual({ outcome: "duplicate" });
    expect(await issueEvent("closed", issue)).toEqual({
      outcome: "processed",
      detail: "already_current",
    });
    expect(
      (
        await support.getGitHubIssueForTicket(
          workspace.id,
          project.id,
          ticket.id,
        )
      )?.status,
    ).toBe("closed");
    expect(
      (await support.getTicketForProject(workspace.id, project.id, ticket.id))
        ?.status,
    ).toBe("resolved");

    // Steps 13–14: reopen restores the active queue because GitHub resolved it.
    const reopenDelivery = randomUUID();
    expect(
      await issueEvent("reopened", issue, { deliveryId: reopenDelivery }),
    ).toEqual({ outcome: "processed", detail: "reopened" });
    expect(
      await issueEvent("reopened", issue, { deliveryId: reopenDelivery }),
    ).toEqual({ outcome: "duplicate" });
    expect(await issueEvent("reopened", issue)).toEqual({
      outcome: "processed",
      detail: "already_current",
    });
    // A late redelivery of the original close cannot regress the reopen.
    expect(
      await issueEvent("closed", issue, { deliveryId: closeDelivery }),
    ).toEqual({ outcome: "duplicate" });
    expect(
      await support.getTicketForProject(workspace.id, project.id, ticket.id),
    ).toMatchObject({
      status: "queued",
      route: "engineering",
      categoryHint: "bug",
    });
    expect(
      (
        await support.getGitHubIssueForTicket(
          workspace.id,
          project.id,
          ticket.id,
        )
      )?.status,
    ).toBe("open");

    // Step 15: one ordered, deduplicated, PII-free audit trail.
    const events = await support.listTicketEvents(project.id, ticket.id);
    expect(events.map((event) => event.type)).toEqual([
      "submitted",
      "classified",
      "github_escalation_requested",
      "github_issue_created",
      "github_issue_closed",
      "ticket_resolved_from_github",
      "github_issue_reopened",
      "ticket_reopened_from_github",
    ]);
    const numbers = events.map((event) => Number(event.eventNumber));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    const auditText = JSON.stringify(
      events.map((event) => [event.type, event.summary]),
    );
    expect(auditText).not.toContain(CONTACT.name);
    expect(auditText).not.toContain(CONTACT.email);
    expect(auditText).not.toContain("Safari");
    expect(
      await support.listClassificationsForTicket(
        workspace.id,
        project.id,
        ticket.id,
      ),
    ).toEqual(history);
    expect(
      await support.getLatestOverride(workspace.id, project.id, ticket.id),
    ).toBeUndefined();
    const deliveries = await db.execute(
      sql`SELECT status, project_id, count(*)::int AS n FROM webhook_events GROUP BY status, project_id ORDER BY status`,
    );
    expect(deliveries.rows).toEqual([
      { status: "ignored", project_id: null, n: 4 },
      { status: "processed", project_id: project.id, n: 4 },
    ]);
  });

  it("keeps the visitor's bug hint separate when the classifier says question", async () => {
    const { workspace, project } = await setupProject("disagree");
    const ticket = await submit(
      project.id,
      "How do I switch the portfolio to dark mode on Safari?",
      { categoryHint: "bug" },
    );
    const { classifier } = recordingClassifier({
      classify: async () => ({
        type: "question",
        severity: "low",
        confidence: 0.97,
        provider: "fixture",
        model: "fixture-v1",
      }),
    });
    expect(await triage(workspace.id, ticket, classifier)).toMatchObject({
      outcome: "classified",
      type: "question",
      route: "support",
      githubEligible: false,
    });
    const stored = await support.getTicketForProject(
      workspace.id,
      project.id,
      ticket.id,
    );
    expect(stored).toMatchObject({
      categoryHint: "bug",
      route: "support",
      status: "queued",
    });
    const input = await escalationInput(workspace.id, ticket);
    expect(await previewFor(workspace.id, input)).toMatchObject({
      state: "blocked",
      code: "GITHUB_NOT_ELIGIBLE",
    });
    const factory = createMockTrackerFactory();
    expect(
      await escalateTicketToGitHub({
        policy: LOCAL_MOCK_POLICY,
        repository: escalationPort,
        trackers: factory,
        ticket: input,
      }),
    ).toMatchObject({ outcome: "blocked", code: "GITHUB_NOT_ELIGIBLE" });
    expect(factory.created).toHaveLength(0);
    expect(
      await support.getGitHubIssueForTicket(
        workspace.id,
        project.id,
        ticket.id,
      ),
    ).toBeUndefined();
  });

  it("recomputes eligibility at confirmation after a preview goes stale", async () => {
    const { workspace, project } = await setupProject("stale");
    const ticket = await submit(project.id, SAFARI_BUG);
    await triage(workspace.id, ticket, new FixtureTicketClassifier());
    expect(
      (
        await previewFor(
          workspace.id,
          await escalationInput(workspace.id, ticket),
        )
      ).state,
    ).toBe("eligible");
    const owner = await createOwner();
    await support.recordTicketOverride(
      workspace.id,
      {
        projectId: project.id,
        ticketId: ticket.id,
        decidedBy: owner.id,
        githubIssueRecommended: false,
        reason: "Duplicate of a known Safari issue.",
      },
      "rerouted",
    );
    const factory = createMockTrackerFactory();
    expect(
      await escalateTicketToGitHub({
        policy: LOCAL_MOCK_POLICY,
        repository: escalationPort,
        trackers: factory,
        ticket: await escalationInput(workspace.id, ticket),
      }),
    ).toMatchObject({ outcome: "blocked", code: "GITHUB_BLOCKED" });

    const resolvedTicket = await submit(project.id, `${SAFARI_BUG} Resolved.`);
    await triage(workspace.id, resolvedTicket, new FixtureTicketClassifier());
    await support.updateTicketStatus(workspace.id, {
      projectId: project.id,
      ticketId: resolvedTicket.id,
      status: "resolved",
      eventType: "resolved",
    });
    expect(
      await escalateTicketToGitHub({
        policy: LOCAL_MOCK_POLICY,
        repository: escalationPort,
        trackers: factory,
        ticket: await escalationInput(workspace.id, resolvedTicket),
      }),
    ).toMatchObject({ outcome: "blocked", code: "GITHUB_NOT_ELIGIBLE" });

    const disconnected = await submit(
      project.id,
      `${SAFARI_BUG} Disconnected.`,
    );
    await triage(workspace.id, disconnected, new FixtureTicketClassifier());
    await db.execute(
      sql`UPDATE github_integrations SET status = 'disconnected' WHERE project_id = ${project.id}`,
    );
    expect(
      await escalateTicketToGitHub({
        policy: LOCAL_MOCK_POLICY,
        repository: escalationPort,
        trackers: factory,
        ticket: await escalationInput(workspace.id, disconnected),
      }),
    ).toEqual({ outcome: "not-configured" });
    expect(factory.created).toHaveLength(0);
    const issues = await db.execute(
      sql`SELECT count(*)::int AS n FROM github_issues`,
    );
    expect(issues.rows[0]).toEqual({ n: 0 });
  });

  it("lets a human resolution outrank later GitHub close and reopen", async () => {
    const { workspace, project, ticket, issue } =
      await linkedBug("human-first");
    await support.updateTicketStatus(workspace.id, {
      projectId: project.id,
      ticketId: ticket.id,
      status: "resolved",
      eventType: "resolved",
      summary: "Owner confirmed a workaround.",
    });
    await issueEvent("closed", issue);
    await issueEvent("reopened", issue);
    expect(
      (await support.getTicketForProject(workspace.id, project.id, ticket.id))
        ?.status,
    ).toBe("resolved");
    expect(
      (
        await support.getGitHubIssueForTicket(
          workspace.id,
          project.id,
          ticket.id,
        )
      )?.status,
    ).toBe("open");
    const types = await eventTypes(project.id, ticket.id);
    expect(types).not.toContain("ticket_resolved_from_github");
    expect(types).not.toContain("ticket_reopened_from_github");
    expect(types.slice(-3)).toEqual([
      "resolved",
      "github_issue_closed",
      "github_issue_reopened",
    ]);
  });

  it("keeps a human reopen after GitHub close when the close is repeated", async () => {
    const { workspace, project, ticket, issue } =
      await linkedBug("human-later");
    await issueEvent("closed", issue);
    await support.updateTicketStatus(workspace.id, {
      projectId: project.id,
      ticketId: ticket.id,
      status: "queued",
      eventType: "reopened",
      summary: "Visitor says the fix did not reach Safari.",
    });
    expect(await issueEvent("closed", issue)).toEqual({
      outcome: "processed",
      detail: "already_current",
    });
    expect(
      (await support.getTicketForProject(workspace.id, project.id, ticket.id))
        ?.status,
    ).toBe("queued");
    expect(
      (await eventTypes(project.id, ticket.id)).filter(
        (type) => type === "ticket_resolved_from_github",
      ),
    ).toHaveLength(1);
  });

  it("retries a clear GitHub rejection by reconciling first, then creates once", async () => {
    const { workspace, project } = await setupProject("retry");
    const ticket = await submit(project.id, SAFARI_BUG);
    await triage(workspace.id, ticket, new FixtureTicketClassifier());
    const factory = createMockTrackerFactory([
      { kind: "rate-limited" },
      { kind: "success" },
    ]);
    const first = await escalateTicketToGitHub({
      policy: LOCAL_MOCK_POLICY,
      repository: escalationPort,
      trackers: factory,
      ticket: await escalationInput(workspace.id, ticket),
    });
    expect(first).toEqual({ outcome: "failed", code: "GITHUB_RATE_LIMITED" });
    expect(
      (
        await support.getGitHubIssueForTicket(
          workspace.id,
          project.id,
          ticket.id,
        )
      )?.status,
    ).toBe("retry_required");
    const second = await escalateTicketToGitHub({
      policy: LOCAL_MOCK_POLICY,
      repository: escalationPort,
      trackers: factory,
      ticket: await escalationInput(workspace.id, ticket),
    });
    expect(second.outcome).toBe("created");
    expect(factory.created).toHaveLength(1);
    expect(await eventTypes(project.id, ticket.id)).toEqual([
      "submitted",
      "classified",
      "github_escalation_requested",
      "github_issue_creation_failed",
      "github_escalation_requested",
      "github_issue_created",
    ]);
    expect(
      (await support.getTicketForProject(workspace.id, project.id, ticket.id))
        ?.status,
    ).toBe("queued");
  });

  it("stops a report carrying credentials and the visitor's name before GitHub", async () => {
    const { workspace, project } = await setupProject("secrets");
    // Assembled at runtime so no credential-shaped literal is committed.
    const token = `${"ghs"}_16C7e42F292c6912E7710c838347Ae178B4a`;
    const ticket = await submit(
      project.id,
      `Ada Tester here. The projects page is blank after login; console shows ${token}.`,
      { contact: CONTACT },
    );
    await triage(workspace.id, ticket, new FixtureTicketClassifier());
    const input = await escalationInput(workspace.id, ticket);
    expect(await previewFor(workspace.id, input)).toEqual({
      state: "blocked",
      code: "GITHUB_PRIVACY_BLOCKED",
      reasons: ["detected api-token", "detected contact-detail"],
    });
    const factory = createMockTrackerFactory();
    expect(
      await escalateTicketToGitHub({
        policy: LOCAL_MOCK_POLICY,
        repository: escalationPort,
        trackers: factory,
        ticket: input,
      }),
    ).toMatchObject({ outcome: "blocked", code: "GITHUB_PRIVACY_BLOCKED" });
    expect(factory.created).toHaveLength(0);
    expect(
      await support.getGitHubIssueForTicket(
        workspace.id,
        project.id,
        ticket.id,
      ),
    ).toBeUndefined();
    const audit = JSON.stringify(
      await support.listTicketEvents(project.id, ticket.id),
    );
    expect(audit).toContain("api-token, contact-detail");
    expect(audit).not.toContain(token);
    expect(audit).not.toContain("Ada");
    // The report stays intact for the operator.
    expect(
      (await support.getTicketSubmissionText(project.id, ticket.id))?.message,
    ).toContain(token);
    expect(
      (await support.getTicketForProject(workspace.id, project.id, ticket.id))
        ?.status,
    ).toBe("queued");
  });

  it("needs an owner recommendation before a real App publishes fixture triage", async () => {
    const { workspace, project } = await setupProject("provenance");
    const ticket = await submit(project.id, SAFARI_BUG);
    await triage(workspace.id, ticket, new FixtureTicketClassifier());
    const factory = createMockTrackerFactory();
    // No policy: this is how the dashboard and CLI call a real GitHub App.
    const blocked = await escalateTicketToGitHub({
      repository: escalationPort,
      trackers: factory,
      ticket: await escalationInput(workspace.id, ticket),
    });
    expect(blocked).toEqual({
      outcome: "blocked",
      code: "GITHUB_NOT_ELIGIBLE",
      reasons: [
        "classification source fixture needs a model result or an owner recommendation",
      ],
    });
    expect(
      await support.getGitHubIssueForTicket(
        workspace.id,
        project.id,
        ticket.id,
      ),
    ).toBeUndefined();
    const owner = await createOwner();
    await support.recordTicketOverride(
      workspace.id,
      {
        projectId: project.id,
        ticketId: ticket.id,
        decidedBy: owner.id,
        githubIssueRecommended: true,
        reason: "Reproduced in Safari 17; publish to engineering.",
      },
      "rerouted",
    );
    const created = await escalateTicketToGitHub({
      repository: escalationPort,
      trackers: factory,
      ticket: await escalationInput(workspace.id, ticket),
    });
    expect(created.outcome).toBe("created");
    expect(factory.created).toHaveLength(1);
    // The AI record is untouched; the human decision is separate.
    expect(
      (
        await support.listClassificationsForTicket(
          workspace.id,
          project.id,
          ticket.id,
        )
      ).map((row) => row.source),
    ).toEqual(["fixture"]);
  });
});
