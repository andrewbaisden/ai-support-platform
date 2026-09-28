import {
  createDatabase,
  createSupportRepository,
  loadRootEnv,
  requireDatabaseUrl,
  ticketReference,
} from "@ai-support-platform/db";
import { createTrackerFactory } from "../app-auth";
import {
  type EscalationRepository,
  escalateTicketToGitHub,
} from "../escalation-service";
import { createMockTrackerFactory } from "../mock";

function usage(): never {
  process.stdout.write(
    `Usage: pnpm github:escalate --ticket <uuid> [--live]

Mock (default) needs no credentials and never touches GitHub.
--live requires GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (\\n-escaped PEM)
and creates a REAL issue in the connected repository: use the disposable
repository only, never the portfolio repository.
`,
  );
  process.exit(2);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

loadRootEnv();
const ticketId = argValue("--ticket");
if (!ticketId || hasFlag("--help") || hasFlag("-h")) usage();
const live = hasFlag("--live");

const { db, pool } = createDatabase(requireDatabaseUrl("DATABASE_URL"));
const support = createSupportRepository(db);
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
    try {
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
        repositoryId: BigInt(integration.repositoryId),
        reconciliationMarker: input.reconciliationMarker,
      });
    } catch (error) {
      // Unique-ticket reservation lost a race or already exists; the
      // reconcile-first flow converges instead of duplicating.
      const retry = await support.getGitHubIssueForTicket(
        input.workspaceId,
        input.projectId,
        input.ticketId,
      );
      if (retry) return;
      throw error;
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
};

try {
  const context = await support.findTicketContext(ticketId);
  if (!context) {
    process.stderr.write(`Ticket not found: ${ticketId}\n`);
    process.exit(1);
  }
  const ticket = await support.getTicketForProject(
    context.workspaceId,
    context.projectId,
    ticketId,
  );
  if (!ticket) {
    process.stderr.write(`Ticket not found: ${ticketId}\n`);
    process.exit(1);
  }
  const submission = await support.getTicketSubmissionText(
    context.projectId,
    ticketId,
  );
  if (!submission) {
    process.stderr.write(`No visitor message for ticket: ${ticketId}\n`);
    process.exit(1);
  }
  const classification = await support.getCurrentClassificationForProject(
    context.workspaceId,
    context.projectId,
    ticketId,
  );
  const override = await support.getLatestOverride(
    context.workspaceId,
    context.projectId,
    ticketId,
  );
  const contact = await support.getConversationContact(
    context.projectId,
    ticket.conversationId,
  );
  const trackers = live
    ? createTrackerFactory({
        appId: process.env.GITHUB_APP_ID ?? "",
        privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? "").replace(
          /\\n/g,
          "\n",
        ),
      })
    : createMockTrackerFactory();
  if (
    live &&
    (!process.env.GITHUB_APP_ID || !process.env.GITHUB_APP_PRIVATE_KEY)
  ) {
    process.stderr.write(
      "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required for --live\n",
    );
    process.exit(2);
  }
  const outcome = await escalateTicketToGitHub({
    repository: port,
    trackers,
    // Synthetic mock runs may use fixture triage; live issues may not.
    policy: { allowFixtureClassifications: !live },
    ticket: {
      ticketId,
      projectId: context.projectId,
      workspaceId: context.workspaceId,
      ticketNumber: ticket.ticketNumber,
      ticketReference: ticketReference(ticket.ticketNumber),
      status: ticket.status,
      route: ticket.route,
      reportedAt: ticket.createdAt,
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
    },
  });
  process.stdout.write(`${outcome.outcome}\n`);
  if (outcome.outcome === "created" || outcome.outcome === "reconciled") {
    process.stdout.write(`${outcome.issue.url}\n`);
  }
  if (outcome.outcome === "failed" || outcome.outcome === "unknown") {
    process.exit(1);
  }
} finally {
  await pool.end();
}
