import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { loadRootEnv, requireSafeTestDatabaseUrl } from "./env";
import { generatePublicProjectKey } from "./inputs";
import { createSupportRepository } from "./repository";
import { githubIssues, tickets, webhookEvents } from "./schema";

loadRootEnv();
const { db, pool } = createDatabase(requireSafeTestDatabaseUrl());
const support = createSupportRepository(db);

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE ticket_overrides, workspace_members, "user", "session", "account", verification, webhook_events, github_issues, github_integrations, ticket_events, ticket_classifications, tickets, messages, conversations, projects, workspaces, submission_rate_limits RESTART IDENTITY CASCADE`,
  );
});
afterAll(async () => {
  await pool.end();
});

async function linkedTicket() {
  const workspace = await support.createWorkspace("Webhook test");
  const project = await support.createProject({
    workspaceId: workspace.id,
    name: "Web",
    slug: "web",
    publicKey: generatePublicProjectKey(),
  });
  const integration = await support.connectGitHubRepository({
    workspaceId: workspace.id,
    projectId: project.id,
    installationId: 10n,
    repositoryId: 20n,
    repositoryOwner: "owner",
    repositoryName: "repo",
  });
  const message = "The export view fails.";
  const ticket = await support.createSubmission({
    projectId: project.id,
    message,
    categoryHint: "bug",
    submissionKey: randomUUID(),
    requestFingerprint: createHash("sha256").update(message).digest("hex"),
  });
  await support.appendClassification(workspace.id, {
    projectId: project.id,
    ticketId: ticket.id,
    type: "bug",
    severity: "high",
    route: "engineering",
    githubIssueRecommended: true,
    confidence: 0.94,
    source: "fixture",
  });
  await support.reserveGitHubIssue({
    workspaceId: workspace.id,
    projectId: project.id,
    ticketId: ticket.id,
    integrationId: integration.id,
    repositoryId: 20n,
    reconciliationMarker: `<!-- ai-support-ticket:SUP-${ticket.ticketNumber} -->`,
  });
  await support.confirmGitHubIssue({
    workspaceId: workspace.id,
    projectId: project.id,
    ticketId: ticket.id,
    githubIssueId: 30n,
    issueNumber: 4,
    url: "https://github.com/owner/repo/issues/4",
  });
  return { workspace, project, ticket };
}

const delivery = (deliveryId: string) => ({
  deliveryId,
  eventType: "issues",
  action: "closed",
  repositoryId: 20n,
  installationId: 10n,
  githubIssueId: 30n,
});

async function close(deliveryId: string) {
  return support.withGitHubWebhookDelivery(
    delivery(deliveryId),
    async (scope) => {
      const link = await scope.findLink({
        repositoryId: 20n,
        githubIssueId: 30n,
      });
      if (!link)
        return { outcome: "ignored" as const, reason: "unknown_issue" };
      if (link.linkStatus === "closed")
        return { outcome: "processed" as const };
      await scope.setIssueState(link.issueId, "closed");
      await scope.recordEvent(
        link.projectId,
        link.ticketId,
        "github_issue_closed",
        "Issue closed",
      );
      await scope.setTicketStatus(
        link.ticketId,
        "resolved",
        "ticket_resolved_from_github",
        "GitHub resolution",
      );
      return { outcome: "processed" as const };
    },
  );
}

describe("webhook transaction", () => {
  it("persists link, ticket, events, and delivery atomically; concurrent duplicate has one result", async () => {
    const { project, ticket } = await linkedTicket();
    const id = randomUUID();
    const results = await Promise.all([close(id), close(id)]);
    expect(results.map((result) => result.outcome).sort()).toEqual([
      "duplicate",
      "processed",
    ]);
    const [link] = await db
      .select()
      .from(githubIssues)
      .where(eq(githubIssues.ticketId, ticket.id));
    const [updated] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticket.id));
    const events = await support.listTicketEvents(project.id, ticket.id);
    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.deliveryId, id));
    expect(link?.status).toBe("closed");
    expect(updated?.status).toBe("resolved");
    expect(
      events.filter((event) => event.type === "ticket_resolved_from_github"),
    ).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("processed");
    await close(randomUUID());
    expect(
      (await support.listTicketEvents(project.id, ticket.id)).filter(
        (event) => event.type === "github_issue_closed",
      ),
    ).toHaveLength(1);
  });

  it("rolls back on failure, allowing the same delivery ID to be retried", async () => {
    const { ticket } = await linkedTicket();
    const id = randomUUID();
    await expect(
      support.withGitHubWebhookDelivery(delivery(id), async (scope) => {
        const link = await scope.findLink({
          repositoryId: 20n,
          githubIssueId: 30n,
        });
        if (!link) throw new Error("fixture missing");
        await scope.setIssueState(link.issueId, "closed");
        throw new Error("temporary failure");
      }),
    ).rejects.toThrow("temporary failure");
    expect(
      (
        await db
          .select()
          .from(webhookEvents)
          .where(eq(webhookEvents.deliveryId, id))
      ).length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(githubIssues)
          .where(eq(githubIssues.ticketId, ticket.id))
      )[0]?.status,
    ).toBe("open");
    expect((await close(id)).outcome).toBe("processed");
  });

  it("finds a link only by matching repository and remote issue IDs", async () => {
    await linkedTicket();
    const result = await support.withGitHubWebhookDelivery(
      delivery(randomUUID()),
      async (scope) => {
        expect(
          await scope.findLink({ repositoryId: 21n, githubIssueId: 30n }),
        ).toBeUndefined();
        expect(
          await scope.findLink({ repositoryId: 20n, githubIssueId: 31n }),
        ).toBeUndefined();
        return { outcome: "ignored" as const, reason: "unknown_issue" };
      },
    );
    expect(result.outcome).toBe("ignored");
  });

  it("keeps GitHub resolution provenance after a review-only event", async () => {
    const { workspace, project, ticket } = await linkedTicket();
    await close(randomUUID());
    await support.recordTicketEvent({
      projectId: project.id,
      ticketId: ticket.id,
      type: "rerouted",
      summary: "Human reviewed the route without changing status.",
    });
    const result = await support.withGitHubWebhookDelivery(
      {
        deliveryId: randomUUID(),
        eventType: "issues",
        action: "reopened",
        repositoryId: 20n,
        githubIssueId: 30n,
        installationId: 10n,
      },
      async (scope) => {
        const link = await scope.findLink({
          repositoryId: 20n,
          githubIssueId: 30n,
        });
        expect(link?.latestStatusEvent).toBe("ticket_resolved_from_github");
        if (!link) throw new Error("fixture link missing");
        await scope.setIssueState(link.issueId, "open");
        await scope.setTicketStatus(
          link.ticketId,
          "queued",
          "ticket_reopened_from_github",
          "Reopened from GitHub",
        );
        return { outcome: "processed" as const };
      },
    );
    expect(result.outcome).toBe("processed");
    expect(
      (await support.getTicketForProject(workspace.id, project.id, ticket.id))
        ?.status,
    ).toBe("queued");
  });
});
