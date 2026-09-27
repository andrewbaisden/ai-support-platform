import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./client";
import {
  type ClassificationInput,
  classificationInputSchema,
  type ProjectInput,
  projectInputSchema,
  type SubmissionInput,
  submissionInputSchema,
} from "./inputs";
import {
  conversations,
  githubIntegrations,
  githubIssues,
  messages,
  projects,
  submissionRateLimits,
  ticketClassifications,
  ticketEvents,
  tickets,
  webhookEvents,
  workspaces,
} from "./schema";

export function ticketReference(ticketNumber: number) {
  return `SUP-${ticketNumber}`;
}

export class SubmissionConflictError extends Error {
  constructor() {
    super("Submission key was reused with different content");
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

export function createSupportRepository(db: Database) {
  async function getSubmission(projectId: string, submissionKey: string) {
    const [ticket] = await db
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.projectId, projectId),
          eq(tickets.submissionKey, submissionKey),
        ),
      )
      .limit(1);
    return ticket;
  }

  function matchingSubmission(
    ticket: typeof tickets.$inferSelect,
    requestFingerprint: string,
  ) {
    if (ticket.requestFingerprint !== requestFingerprint) {
      throw new SubmissionConflictError();
    }
    return ticket;
  }

  async function getTicketForProject(
    workspaceId: string,
    projectId: string,
    ticketId: string,
  ) {
    const [row] = await db
      .select({ ticket: tickets })
      .from(tickets)
      .innerJoin(projects, eq(tickets.projectId, projects.id))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          eq(projects.id, projectId),
          eq(tickets.id, ticketId),
        ),
      )
      .limit(1);
    return row?.ticket;
  }

  return {
    async getSubmissionForRetry(
      projectId: string,
      submissionKey: string,
      requestFingerprint: string,
    ) {
      const existing = await getSubmission(projectId, submissionKey);
      return existing
        ? matchingSubmission(existing, requestFingerprint)
        : undefined;
    },
    async consumeSubmissionRateLimit(
      projectId: string,
      windowStart: Date,
      limit: number,
    ) {
      const [row] = await db
        .insert(submissionRateLimits)
        .values({ projectId, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [
            submissionRateLimits.projectId,
            submissionRateLimits.windowStart,
          ],
          set: { count: sql`${submissionRateLimits.count} + 1` },
          setWhere: sql`${submissionRateLimits.count} < ${limit}`,
        })
        .returning({ count: submissionRateLimits.count });
      return Boolean(row);
    },
    async createWorkspace(name: string) {
      const validName = z.string().trim().min(1).max(120).parse(name);
      const [workspace] = await db
        .insert(workspaces)
        .values({ name: validName })
        .returning();
      if (!workspace) throw new Error("Workspace insert did not return a row");
      return workspace;
    },

    async createProject(input: ProjectInput) {
      const valid = projectInputSchema.parse(input);
      const [project] = await db.insert(projects).values(valid).returning();
      if (!project) throw new Error("Project insert did not return a row");
      return project;
    },

    async getProjectForWorkspace(workspaceId: string, projectId: string) {
      const [project] = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            eq(projects.id, projectId),
          ),
        )
        .limit(1);
      return project;
    },

    async getProjectByPublicKey(publicKey: string) {
      const [project] = await db
        .select()
        .from(projects)
        .where(
          and(eq(projects.publicKey, publicKey), eq(projects.status, "active")),
        )
        .limit(1);
      return project;
    },

    async createSubmission(input: SubmissionInput) {
      const valid = submissionInputSchema.parse(input);
      const existing = await getSubmission(
        valid.projectId,
        valid.submissionKey,
      );
      if (existing)
        return matchingSubmission(existing, valid.requestFingerprint);

      try {
        return await db.transaction(async (tx) => {
          const [project] = await tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.id, valid.projectId),
                eq(projects.status, "active"),
              ),
            )
            .limit(1);
          if (!project) throw new Error("Active project not found");

          const [conversation] = await tx
            .insert(conversations)
            .values({
              projectId: valid.projectId,
              visitorName: valid.visitorName,
              visitorEmail: valid.visitorEmail,
            })
            .returning();
          if (!conversation)
            throw new Error("Conversation insert did not return a row");

          await tx.insert(messages).values({
            projectId: valid.projectId,
            conversationId: conversation.id,
            role: "visitor",
            body: valid.message,
          });

          const [ticket] = await tx
            .insert(tickets)
            .values({
              projectId: valid.projectId,
              conversationId: conversation.id,
              submissionKey: valid.submissionKey,
              requestFingerprint: valid.requestFingerprint,
              categoryHint: valid.categoryHint,
            })
            .returning();
          if (!ticket) throw new Error("Ticket insert did not return a row");

          await tx.insert(ticketEvents).values({
            projectId: valid.projectId,
            ticketId: ticket.id,
            type: "submitted",
          });
          return ticket;
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          const duplicate = await getSubmission(
            valid.projectId,
            valid.submissionKey,
          );
          if (duplicate)
            return matchingSubmission(duplicate, valid.requestFingerprint);
        }
        throw error;
      }
    },

    getTicketForProject,

    async getCurrentClassificationForProject(
      workspaceId: string,
      projectId: string,
      ticketId: string,
    ) {
      const [row] = await db
        .select({ classification: ticketClassifications })
        .from(ticketClassifications)
        .innerJoin(tickets, eq(ticketClassifications.ticketId, tickets.id))
        .innerJoin(projects, eq(tickets.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            eq(projects.id, projectId),
            eq(tickets.id, ticketId),
          ),
        )
        .orderBy(desc(ticketClassifications.classificationNumber))
        .limit(1);
      return row?.classification;
    },

    async listTicketsForProject(workspaceId: string, projectId: string) {
      const rows = await db
        .select({ ticket: tickets })
        .from(tickets)
        .innerJoin(projects, eq(tickets.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            eq(projects.id, projectId),
          ),
        )
        .orderBy(desc(tickets.ticketNumber));
      return rows.map((row) => row.ticket);
    },

    async appendClassification(
      workspaceId: string,
      input: ClassificationInput,
    ) {
      const valid = classificationInputSchema.parse(input);
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({ status: tickets.status })
          .from(tickets)
          .innerJoin(projects, eq(tickets.projectId, projects.id))
          .where(
            and(
              eq(projects.workspaceId, workspaceId),
              eq(projects.id, valid.projectId),
              eq(tickets.id, valid.ticketId),
            ),
          )
          .for("update")
          .limit(1);
        if (!row) throw new Error("Ticket not found in workspace/project");
        if (!["needs_triage", "queued", "quarantined"].includes(row.status)) {
          throw new Error(`Cannot classify ticket in ${row.status} state`);
        }

        const [classification] = await tx
          .insert(ticketClassifications)
          .values(valid)
          .returning();
        if (!classification)
          throw new Error("Classification insert did not return a row");
        await tx
          .update(tickets)
          .set({
            route: valid.route,
            status: valid.route === "ignore" ? "quarantined" : "queued",
            updatedAt: new Date(),
          })
          .where(eq(tickets.id, valid.ticketId));
        await tx.insert(ticketEvents).values({
          projectId: valid.projectId,
          ticketId: valid.ticketId,
          type: "classified",
        });
        return classification;
      });
    },

    async connectGitHubRepository(input: {
      workspaceId: string;
      projectId: string;
      installationId: bigint;
      repositoryId: bigint;
      repositoryOwner: string;
      repositoryName: string;
    }) {
      const project = await this.getProjectForWorkspace(
        input.workspaceId,
        input.projectId,
      );
      if (!project) throw new Error("Project not found in workspace");
      const [integration] = await db
        .insert(githubIntegrations)
        .values({
          projectId: input.projectId,
          installationId: input.installationId,
          repositoryId: input.repositoryId,
          repositoryOwner: input.repositoryOwner,
          repositoryName: input.repositoryName,
        })
        .returning();
      if (!integration)
        throw new Error("Integration insert did not return a row");
      return integration;
    },

    async reserveGitHubIssue(input: {
      workspaceId: string;
      projectId: string;
      ticketId: string;
      integrationId: string;
      repositoryId: bigint;
      reconciliationMarker: string;
    }) {
      const ticket = await getTicketForProject(
        input.workspaceId,
        input.projectId,
        input.ticketId,
      );
      if (!ticket) throw new Error("Ticket not found in workspace/project");
      const [issue] = await db
        .insert(githubIssues)
        .values({
          projectId: input.projectId,
          ticketId: input.ticketId,
          integrationId: input.integrationId,
          repositoryId: input.repositoryId,
          reconciliationMarker: input.reconciliationMarker,
        })
        .returning();
      if (!issue) throw new Error("Issue reservation did not return a row");
      return issue;
    },

    async recordWebhookDelivery(input: {
      deliveryId: string;
      eventType: string;
      action?: string;
      projectId?: string;
      installationId?: bigint;
      repositoryId?: bigint;
      githubIssueId?: bigint;
    }) {
      const [event] = await db
        .insert(webhookEvents)
        .values(input)
        .onConflictDoNothing({
          target: [webhookEvents.provider, webhookEvents.deliveryId],
        })
        .returning();
      return event;
    },
  };
}
