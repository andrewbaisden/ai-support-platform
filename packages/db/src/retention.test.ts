import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { loadRootEnv, requireSafeTestDatabaseUrl } from "./env";
import { generatePublicProjectKey } from "./inputs";
import { createSupportRepository } from "./repository";

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

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-28T12:00:00.000Z");

async function ticketWithContact(
  projectId: string,
  workspaceId: string,
  options: { resolvedDaysAgo?: number; status?: "queued" | "resolved" },
) {
  const message = `Retention probe ${randomUUID()}: the export page is blank.`;
  const ticket = await support.createSubmission({
    projectId,
    message,
    categoryHint: "bug",
    submissionKey: randomUUID(),
    requestFingerprint: createHash("sha256").update(message).digest("hex"),
    visitorName: "Ada Tester",
    visitorEmail: "ada.tester@example.test",
  });
  if (options.status === "resolved") {
    await support.updateTicketStatus(workspaceId, {
      projectId,
      ticketId: ticket.id,
      status: "resolved",
      eventType: "resolved",
    });
    const at = new Date(now.getTime() - (options.resolvedDaysAgo ?? 0) * DAY);
    await db.execute(
      sql`UPDATE tickets SET updated_at = ${at} WHERE id = ${ticket.id}`,
    );
  }
  return ticket;
}

async function setup() {
  const workspace = await support.createWorkspace("Retention");
  const project = await support.createProject({
    workspaceId: workspace.id,
    name: "Retention",
    slug: "retention",
    publicKey: generatePublicProjectKey(),
  });
  return { workspace, project };
}

describe("retention", () => {
  it("erases contact details only from tickets resolved before the cutoff", async () => {
    const { workspace, project } = await setup();
    const old = await ticketWithContact(project.id, workspace.id, {
      status: "resolved",
      resolvedDaysAgo: 200,
    });
    const recent = await ticketWithContact(project.id, workspace.id, {
      status: "resolved",
      resolvedDaysAgo: 10,
    });
    const open = await ticketWithContact(project.id, workspace.id, {
      status: "queued",
    });
    const cutoff = new Date(now.getTime() - 180 * DAY);

    // Dry run reports without changing anything.
    expect(
      await support.eraseResolvedContactDetails({
        resolvedBefore: cutoff,
        dryRun: true,
      }),
    ).toEqual({ tickets: 1 });
    expect(
      await support.getConversationContact(project.id, old.conversationId),
    ).toEqual({
      visitorName: "Ada Tester",
      visitorEmail: "ada.tester@example.test",
    });

    expect(
      await support.eraseResolvedContactDetails({ resolvedBefore: cutoff }),
    ).toEqual({ tickets: 1 });
    expect(
      await support.getConversationContact(project.id, old.conversationId),
    ).toEqual({ visitorName: null, visitorEmail: null });
    for (const kept of [recent, open]) {
      expect(
        await support.getConversationContact(project.id, kept.conversationId),
      ).toEqual({
        visitorName: "Ada Tester",
        visitorEmail: "ada.tester@example.test",
      });
    }
    // The report and the audit trail remain; the erasure is recorded.
    expect(
      (await support.getTicketSubmissionText(project.id, old.id))?.message,
    ).toContain("Retention probe");
    const events = await support.listTicketEvents(project.id, old.id);
    expect(events.map((event) => event.type)).toEqual([
      "submitted",
      "resolved",
      "contact_details_erased",
    ]);
    expect(JSON.stringify(events)).not.toContain("ada.tester");
    // Idempotent: nothing left to erase.
    expect(
      await support.eraseResolvedContactDetails({ resolvedBefore: cutoff }),
    ).toEqual({ tickets: 0 });
  });

  it("deletes only old processed or ignored webhook delivery records", async () => {
    const old = new Date(now.getTime() - 120 * DAY);
    const recent = new Date(now.getTime() - 5 * DAY);
    for (const [status, receivedAt] of [
      ["processed", old],
      ["ignored", old],
      ["received", old],
      ["processed", recent],
    ] as const) {
      await db.execute(
        sql`INSERT INTO webhook_events (delivery_id, event_type, status, received_at)
            VALUES (${randomUUID()}, 'issues', ${status}, ${receivedAt})`,
      );
    }
    const cutoff = new Date(now.getTime() - 90 * DAY);
    expect(
      await support.deleteWebhookDeliveries({
        receivedBefore: cutoff,
        dryRun: true,
      }),
    ).toEqual({ deliveries: 2 });
    expect(
      await support.deleteWebhookDeliveries({ receivedBefore: cutoff }),
    ).toEqual({ deliveries: 2 });
    const left = await db.execute(
      sql`SELECT status FROM webhook_events ORDER BY status`,
    );
    expect(left.rows).toEqual([
      { status: "processed" },
      { status: "received" },
    ]);
  });
});
