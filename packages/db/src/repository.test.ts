import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { loadRootEnv, requireSafeTestDatabaseUrl } from "./env";
import { generatePublicProjectKey } from "./inputs";
import { createSupportRepository } from "./repository";
import {
  conversations,
  githubIssues,
  messages,
  projects,
  ticketClassifications,
  ticketEvents,
  tickets,
  webhookEvents,
  workspaces,
} from "./schema";

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
    TRUNCATE TABLE webhook_events, github_issues, github_integrations,
      ticket_events, ticket_classifications, tickets, messages,
      conversations, projects, workspaces RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await pool.end();
});

async function twoTenants() {
  const firstWorkspace = await repository.createWorkspace("First workspace");
  const secondWorkspace = await repository.createWorkspace("Second workspace");
  const firstProject = await repository.createProject({
    workspaceId: firstWorkspace.id,
    name: "First project",
    slug: "shared-slug",
    publicKey: generatePublicProjectKey(),
  });
  const secondProject = await repository.createProject({
    workspaceId: secondWorkspace.id,
    name: "Second project",
    slug: "shared-slug",
    publicKey: generatePublicProjectKey(),
  });
  return { firstWorkspace, secondWorkspace, firstProject, secondProject };
}

async function submit(
  projectId: string,
  message = "The site is blank in Safari.",
) {
  return repository.createSubmission({
    projectId,
    message,
    submissionKey: randomUUID(),
    requestFingerprint: createHash("sha256").update(message).digest("hex"),
  });
}

describe("domain persistence", () => {
  it("keeps project keys globally unique while slugs are workspace scoped", async () => {
    const { firstWorkspace, secondWorkspace, firstProject, secondProject } =
      await twoTenants();
    expect(firstProject.workspaceId).toBe(firstWorkspace.id);
    expect(secondProject.workspaceId).toBe(secondWorkspace.id);
    expect(
      await repository.getProjectForWorkspace(
        secondWorkspace.id,
        firstProject.id,
      ),
    ).toBeUndefined();
    expect(
      await repository.getProjectByPublicKey(firstProject.publicKey),
    ).toMatchObject({
      id: firstProject.id,
    });
    await expect(
      repository.createProject({
        workspaceId: secondWorkspace.id,
        name: "Duplicate key",
        slug: "another-slug",
        publicKey: firstProject.publicKey,
      }),
    ).rejects.toThrow();
  });

  it("atomically creates one conversation, visitor message, ticket, and event per submission", async () => {
    const { firstProject } = await twoTenants();
    const message =
      "The projects section becomes blank in Safari after switching to dark mode.";
    const submissionKey = randomUUID();
    const requestFingerprint = createHash("sha256")
      .update(message)
      .digest("hex");
    const input = {
      projectId: firstProject.id,
      message,
      submissionKey,
      requestFingerprint,
    };
    const first = await repository.createSubmission(input);
    const retry = await repository.createSubmission(input);
    expect(retry.id).toBe(first.id);
    expect(first.ticketNumber).toBeGreaterThan(0);
    expect(await db.select().from(conversations)).toHaveLength(1);
    expect(await db.select().from(messages)).toMatchObject([
      { body: message, role: "visitor" },
    ]);
    expect(await db.select().from(tickets)).toHaveLength(1);
    expect(await db.select().from(ticketEvents)).toMatchObject([
      { type: "submitted" },
    ]);
    await expect(
      repository.createSubmission({
        ...input,
        requestFingerprint: "a".repeat(64),
      }),
    ).rejects.toThrow("different content");
  });

  it("keeps concurrent identical retries to a single logical ticket", async () => {
    const { firstProject } = await twoTenants();
    const message =
      "The projects section becomes blank in Safari after switching to dark mode.";
    const submissionKey = randomUUID();
    const requestFingerprint = createHash("sha256")
      .update(JSON.stringify([1, "bug", message, "", ""]))
      .digest("hex");
    const input = {
      projectId: firstProject.id,
      categoryHint: "bug" as const,
      message,
      submissionKey,
      requestFingerprint,
    };
    const outcomes = await Promise.allSettled([
      repository.createSubmission(input),
      repository.createSubmission(input),
      repository.createSubmission(input),
    ]);
    const ids: string[] = [];
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("fulfilled");
      if (outcome.status === "fulfilled") ids.push(outcome.value.id);
    }
    expect(ids).toHaveLength(3);
    expect(new Set(ids)).toHaveLength(1);
    expect(await db.select().from(conversations)).toHaveLength(1);
    expect(await db.select().from(tickets)).toHaveLength(1);
    expect(await db.select().from(ticketEvents)).toHaveLength(1);
    expect(await db.select().from(tickets)).toMatchObject([
      {
        submissionKey,
        requestFingerprint,
        categoryHint: "bug",
        status: "needs_triage",
      },
    ]);
  });

  it("prevents cross-project ticket and message links and isolates repository reads", async () => {
    const { firstWorkspace, secondWorkspace, firstProject, secondProject } =
      await twoTenants();
    const ticket = await submit(firstProject.id);
    expect(
      await repository.getTicketForProject(
        firstWorkspace.id,
        firstProject.id,
        ticket.id,
      ),
    ).toMatchObject({
      id: ticket.id,
    });
    expect(
      await repository.getTicketForProject(
        secondWorkspace.id,
        firstProject.id,
        ticket.id,
      ),
    ).toBeUndefined();
    expect(
      await repository.listTicketsForProject(
        secondWorkspace.id,
        firstProject.id,
      ),
    ).toEqual([]);
    expect(
      await repository.listTicketsForProject(
        firstWorkspace.id,
        secondProject.id,
      ),
    ).toEqual([]);
    await expect(
      db.insert(tickets).values({
        projectId: secondProject.id,
        conversationId: ticket.conversationId,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(messages).values({
        projectId: secondProject.id,
        conversationId: ticket.conversationId,
        role: "visitor",
        body: "wrong project",
      }),
    ).rejects.toThrow();
    await expect(
      db.delete(projects).where(eq(projects.id, firstProject.id)),
    ).rejects.toThrow();
    await expect(
      db.delete(workspaces).where(eq(workspaces.id, firstWorkspace.id)),
    ).rejects.toThrow();
  });

  it("keeps classification history and applies guarded ticket transitions", async () => {
    const { firstWorkspace, firstProject, secondWorkspace } =
      await twoTenants();
    const ticket = await submit(firstProject.id);
    const input = {
      projectId: firstProject.id,
      ticketId: ticket.id,
      type: "bug" as const,
      severity: "medium" as const,
      route: "engineering" as const,
      githubIssueRecommended: true,
      confidence: 0.94,
      source: "fixture" as const,
    };
    await expect(
      repository.appendClassification(secondWorkspace.id, input),
    ).rejects.toThrow();
    const first = await repository.appendClassification(
      firstWorkspace.id,
      input,
    );
    const second = await repository.appendClassification(firstWorkspace.id, {
      ...input,
      route: "support",
      githubIssueRecommended: false,
      source: "manual",
    });
    expect(first.id).not.toBe(second.id);
    expect(await db.select().from(ticketClassifications)).toHaveLength(2);
    expect(
      await repository.getCurrentClassificationForProject(
        firstWorkspace.id,
        firstProject.id,
        ticket.id,
      ),
    ).toMatchObject({ id: second.id, route: "support" });
    expect(
      await repository.getCurrentClassificationForProject(
        secondWorkspace.id,
        firstProject.id,
        ticket.id,
      ),
    ).toBeUndefined();
    expect(
      await repository.getTicketForProject(
        firstWorkspace.id,
        firstProject.id,
        ticket.id,
      ),
    ).toMatchObject({
      status: "queued",
      route: "support",
    });
    await expect(
      repository.appendClassification(firstWorkspace.id, {
        ...input,
        confidence: 1.5,
      }),
    ).rejects.toThrow();
  });

  it("reserves one GitHub intent for the correct ticket, project, and repository", async () => {
    const { firstWorkspace, firstProject, secondProject } = await twoTenants();
    const ticket = await submit(firstProject.id);
    const integration = await repository.connectGitHubRepository({
      workspaceId: firstWorkspace.id,
      projectId: firstProject.id,
      installationId: 10n,
      repositoryId: 20n,
      repositoryOwner: "demo",
      repositoryName: "disposable",
    });
    const reservation = {
      workspaceId: firstWorkspace.id,
      projectId: firstProject.id,
      ticketId: ticket.id,
      integrationId: integration.id,
      repositoryId: 20n,
      reconciliationMarker: `ticket-${ticket.id}`,
    };
    const issue = await repository.reserveGitHubIssue(reservation);
    expect(issue).toMatchObject({ status: "pending", githubIssueId: null });
    await expect(
      db
        .update(githubIssues)
        .set({ status: "open" })
        .where(eq(githubIssues.id, issue.id)),
    ).rejects.toThrow();
    await expect(repository.reserveGitHubIssue(reservation)).rejects.toThrow();
    await expect(
      repository.reserveGitHubIssue({
        ...reservation,
        repositoryId: 21n,
        reconciliationMarker: "other",
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(githubIssues).values({
        projectId: secondProject.id,
        ticketId: ticket.id,
        integrationId: integration.id,
        repositoryId: 20n,
        reconciliationMarker: "cross-project",
      }),
    ).rejects.toThrow();
    await db
      .update(githubIssues)
      .set({
        githubIssueId: 100n,
        issueNumber: 1,
        url: "https://github.com/demo/disposable/issues/1",
        status: "open",
      })
      .where(eq(githubIssues.id, issue.id));
    const secondTicket = await submit(firstProject.id, "Another Safari report");
    const secondIssue = await repository.reserveGitHubIssue({
      ...reservation,
      ticketId: secondTicket.id,
      reconciliationMarker: `ticket-${secondTicket.id}`,
    });
    await expect(
      db
        .update(githubIssues)
        .set({
          githubIssueId: 100n,
          issueNumber: 1,
          url: "https://github.com/demo/disposable/issues/1",
          status: "open",
        })
        .where(eq(githubIssues.id, secondIssue.id)),
    ).rejects.toThrow();
  });

  it("deduplicates webhook deliveries without storing their raw payload", async () => {
    const first = await repository.recordWebhookDelivery({
      deliveryId: "delivery-123",
      eventType: "issues",
      action: "closed",
      repositoryId: 20n,
    });
    const retry = await repository.recordWebhookDelivery({
      deliveryId: "delivery-123",
      eventType: "issues",
      action: "closed",
      repositoryId: 20n,
    });
    expect(first?.status).toBe("received");
    expect(retry).toBeUndefined();
    expect(await db.select().from(webhookEvents)).toHaveLength(1);
    expect(Object.keys(first ?? {})).not.toContain("payload");
  });
});
