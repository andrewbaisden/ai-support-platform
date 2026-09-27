import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./client";
import {
  type ClassificationInput,
  classificationInputSchema,
  type ProjectInput,
  projectInputSchema,
  type SubmissionInput,
  submissionInputSchema,
  type TicketOverrideInput,
  ticketOverrideInputSchema,
  type WorkspaceMemberInput,
  workspaceMemberInputSchema,
} from "./inputs";
import {
  conversations,
  githubIntegrations,
  githubIssues,
  messages,
  projects,
  type Severity,
  severities,
  submissionRateLimits,
  type TicketRoute,
  type TicketStatus,
  type TicketType,
  ticketClassifications,
  ticketEvents,
  ticketOverrides,
  ticketRoutes,
  ticketStatuses,
  tickets,
  ticketTypes,
  users,
  webhookEvents,
  workspaceMembers,
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

    async listTicketsNeedingTriage(limit: number) {
      const take = z.number().int().min(1).max(100).parse(limit);
      return db
        .select({
          ticketId: tickets.id,
          projectId: tickets.projectId,
          workspaceId: projects.workspaceId,
          status: tickets.status,
        })
        .from(tickets)
        .innerJoin(projects, eq(tickets.projectId, projects.id))
        .where(eq(tickets.status, "needs_triage"))
        .orderBy(tickets.createdAt)
        .limit(take);
    },

    async findTicketContext(ticketId: string) {
      const validated = z.uuid().parse(ticketId);
      const [row] = await db
        .select({
          ticketId: tickets.id,
          projectId: tickets.projectId,
          workspaceId: projects.workspaceId,
          status: tickets.status,
        })
        .from(tickets)
        .innerJoin(projects, eq(tickets.projectId, projects.id))
        .where(eq(tickets.id, validated))
        .limit(1);
      return row;
    },

    async getTicketSubmissionText(projectId: string, ticketId: string) {
      const [ticket] = await db
        .select()
        .from(tickets)
        .where(and(eq(tickets.id, ticketId), eq(tickets.projectId, projectId)))
        .limit(1);
      if (!ticket) return undefined;
      const [message] = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.projectId, projectId),
            eq(messages.conversationId, ticket.conversationId),
            eq(messages.role, "visitor"),
          ),
        )
        .orderBy(messages.createdAt)
        .limit(1);
      if (!message) return undefined;
      return {
        ticketId: ticket.id,
        projectId: ticket.projectId,
        categoryHint: ticket.categoryHint,
        message: message.body,
      };
    },

    async recordTicketEvent(input: {
      projectId: string;
      ticketId: string;
      type: string;
    }) {
      const valid = z
        .object({
          projectId: z.uuid(),
          ticketId: z.uuid(),
          type: z.string().trim().min(1).max(80),
        })
        .parse(input);
      const [event] = await db.insert(ticketEvents).values(valid).returning();
      if (!event) throw new Error("Ticket event insert did not return a row");
      return event;
    },

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

    async listTicketsForDashboard(
      workspaceId: string,
      projectId: string,
      filters: {
        statuses?: TicketStatus[];
        routes?: TicketRoute[];
        types?: TicketType[];
        severities?: Severity[];
        ticketNumber?: number;
      },
      pagination: { limit: number; offset: number },
    ) {
      const validFilters = z
        .object({
          statuses: z.array(z.enum(ticketStatuses)).max(6).optional(),
          routes: z.array(z.enum(ticketRoutes)).max(4).optional(),
          types: z.array(z.enum(ticketTypes)).max(8).optional(),
          severities: z.array(z.enum(severities)).max(4).optional(),
          ticketNumber: z.number().int().positive().optional(),
        })
        .parse(filters);
      const validPage = z
        .object({
          limit: z.number().int().min(1).max(100),
          offset: z.number().int().min(0),
        })
        .parse(pagination);
      const ticketConditions = [
        eq(projects.workspaceId, workspaceId),
        eq(projects.id, projectId),
      ];
      if (validFilters.statuses?.length) {
        ticketConditions.push(inArray(tickets.status, validFilters.statuses));
      }
      if (validFilters.routes?.length) {
        ticketConditions.push(inArray(tickets.route, validFilters.routes));
      }
      if (validFilters.ticketNumber !== undefined) {
        ticketConditions.push(
          eq(tickets.ticketNumber, validFilters.ticketNumber),
        );
      }
      if (validFilters.types?.length || validFilters.severities?.length) {
        const matching = await db
          .selectDistinctOn([ticketClassifications.ticketId], {
            ticketId: ticketClassifications.ticketId,
          })
          .from(ticketClassifications)
          .innerJoin(tickets, eq(ticketClassifications.ticketId, tickets.id))
          .innerJoin(projects, eq(tickets.projectId, projects.id))
          .where(
            and(
              eq(projects.workspaceId, workspaceId),
              eq(projects.id, projectId),
              ...(validFilters.types?.length
                ? [inArray(ticketClassifications.type, validFilters.types)]
                : []),
              ...(validFilters.severities?.length
                ? [
                    inArray(
                      ticketClassifications.severity,
                      validFilters.severities,
                    ),
                  ]
                : []),
            ),
          )
          .orderBy(
            ticketClassifications.ticketId,
            desc(ticketClassifications.classificationNumber),
          );
        // Latest attempt per ticket decides; a ticket matches only when its
        // current classification satisfies every requested AI filter.
        const currentMatches = await db
          .selectDistinctOn([ticketClassifications.ticketId], {
            ticketId: ticketClassifications.ticketId,
            type: ticketClassifications.type,
            severity: ticketClassifications.severity,
          })
          .from(ticketClassifications)
          .where(
            inArray(
              ticketClassifications.ticketId,
              matching.map((row) => row.ticketId),
            ),
          )
          .orderBy(
            ticketClassifications.ticketId,
            desc(ticketClassifications.classificationNumber),
          );
        const matchingIds = currentMatches
          .filter(
            (row) =>
              (!validFilters.types?.length ||
                validFilters.types.includes(row.type)) &&
              (!validFilters.severities?.length ||
                validFilters.severities.includes(row.severity)),
          )
          .map((row) => row.ticketId);
        ticketConditions.push(inArray(tickets.id, matchingIds));
      }
      const where = and(...ticketConditions);
      const [countRows, ticketRows] = await Promise.all([
        db
          .select({ value: count() })
          .from(tickets)
          .innerJoin(projects, eq(tickets.projectId, projects.id))
          .where(where),
        db
          .select()
          .from(tickets)
          .innerJoin(projects, eq(tickets.projectId, projects.id))
          .where(where)
          .orderBy(desc(tickets.ticketNumber))
          .limit(validPage.limit)
          .offset(validPage.offset),
      ]);
      const total = countRows[0]?.value ?? 0;
      const pageTickets = ticketRows.map((row) => row.tickets);
      const pageClassifications =
        pageTickets.length === 0
          ? []
          : await db
              .selectDistinctOn([ticketClassifications.ticketId], {
                ticketId: ticketClassifications.ticketId,
                type: ticketClassifications.type,
                severity: ticketClassifications.severity,
                confidence: ticketClassifications.confidence,
                githubIssueRecommended:
                  ticketClassifications.githubIssueRecommended,
              })
              .from(ticketClassifications)
              .where(
                inArray(
                  ticketClassifications.ticketId,
                  pageTickets.map((ticket) => ticket.id),
                ),
              )
              .orderBy(
                ticketClassifications.ticketId,
                desc(ticketClassifications.classificationNumber),
              );
      const byTicket = new Map(
        pageClassifications.map((row) => [row.ticketId, row]),
      );
      return {
        total,
        rows: pageTickets.map((ticket) => ({
          ticket,
          classification: byTicket.get(ticket.id),
        })),
      };
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

    async createWorkspaceMember(input: WorkspaceMemberInput) {
      const valid = workspaceMemberInputSchema.parse(input);
      const [member] = await db
        .insert(workspaceMembers)
        .values(valid)
        .onConflictDoNothing({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
        })
        .returning();
      if (!member) throw new Error("Membership already exists");
      return member;
    },

    async listWorkspacesForUser(userId: string) {
      const rows = await db
        .select({ workspace: workspaces, role: workspaceMembers.role })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(eq(workspaceMembers.userId, userId))
        .orderBy(workspaces.name);
      return rows;
    },

    async getProjectWorkspace(projectId: string) {
      const [row] = await db
        .select({ workspaceId: projects.workspaceId })
        .from(projects)
        .where(eq(projects.id, z.uuid().parse(projectId)))
        .limit(1);
      return row;
    },

    async listProjectsForWorkspace(workspaceId: string) {
      return db
        .select()
        .from(projects)
        .where(eq(projects.workspaceId, workspaceId))
        .orderBy(projects.name);
    },

    async getTicketStatusCounts(workspaceId: string, projectId: string) {
      return db
        .select({ status: tickets.status, count: count() })
        .from(tickets)
        .innerJoin(projects, eq(tickets.projectId, projects.id))
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            eq(projects.id, projectId),
          ),
        )
        .groupBy(tickets.status);
    },

    async listClassificationsForTicket(
      workspaceId: string,
      projectId: string,
      ticketId: string,
    ) {
      const rows = await db
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
        .orderBy(desc(ticketClassifications.classificationNumber));
      return rows.map((row) => row.classification);
    },

    async getConversationContact(projectId: string, conversationId: string) {
      const [row] = await db
        .select({
          visitorName: conversations.visitorName,
          visitorEmail: conversations.visitorEmail,
        })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.projectId, projectId),
          ),
        )
        .limit(1);
      return row;
    },

    async getLatestOverride(
      workspaceId: string,
      projectId: string,
      ticketId: string,
    ) {
      const [row] = await db
        .select({ override: ticketOverrides, authorEmail: users.email })
        .from(ticketOverrides)
        .innerJoin(tickets, eq(ticketOverrides.ticketId, tickets.id))
        .innerJoin(projects, eq(tickets.projectId, projects.id))
        .innerJoin(users, eq(ticketOverrides.decidedBy, users.id))
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            eq(projects.id, projectId),
            eq(tickets.id, ticketId),
          ),
        )
        .orderBy(desc(ticketOverrides.createdAt))
        .limit(1);
      return row;
    },

    async recordTicketOverride(
      workspaceId: string,
      input: TicketOverrideInput,
      eventType: string,
    ) {
      const valid = ticketOverrideInputSchema.parse(input);
      const validEvent = z.string().trim().min(1).max(80).parse(eventType);
      return db.transaction(async (tx) => {
        const [scope] = await tx
          .select({ id: tickets.id })
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
        if (!scope) throw new Error("Ticket not found in workspace/project");
        const [override] = await tx
          .insert(ticketOverrides)
          .values({
            projectId: valid.projectId,
            ticketId: valid.ticketId,
            decidedBy: valid.decidedBy,
            route: valid.route,
            status: valid.status,
            githubIssueRecommended: valid.githubIssueRecommended,
            reason: valid.reason,
          })
          .returning();
        if (!override) throw new Error("Override insert did not return a row");
        const patch: Partial<{ route: TicketRoute; status: TicketStatus }> = {};
        if (valid.route !== undefined) patch.route = valid.route;
        if (valid.status !== undefined) patch.status = valid.status;
        if (Object.keys(patch).length > 0) {
          await tx
            .update(tickets)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(tickets.id, valid.ticketId));
        }
        await tx.insert(ticketEvents).values({
          projectId: valid.projectId,
          ticketId: valid.ticketId,
          type: validEvent,
          summary: `Owner override: ${valid.reason}`,
        });
        return override;
      });
    },

    async updateTicketStatus(
      workspaceId: string,
      input: {
        projectId: string;
        ticketId: string;
        status: TicketStatus;
        eventType: string;
      },
    ) {
      const valid = z
        .object({
          projectId: z.uuid(),
          ticketId: z.uuid(),
          status: z.enum([
            "needs_triage",
            "queued",
            "escalation_pending",
            "escalated",
            "resolved",
            "quarantined",
          ]),
          eventType: z.string().trim().min(1).max(80),
        })
        .parse(input);
      return db.transaction(async (tx) => {
        const [scope] = await tx
          .select({ id: tickets.id })
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
        if (!scope) throw new Error("Ticket not found in workspace/project");
        const [ticket] = await tx
          .update(tickets)
          .set({ status: valid.status, updatedAt: new Date() })
          .where(eq(tickets.id, valid.ticketId))
          .returning();
        if (!ticket) throw new Error("Ticket update did not return a row");
        await tx.insert(ticketEvents).values({
          projectId: valid.projectId,
          ticketId: valid.ticketId,
          type: valid.eventType,
        });
        return ticket;
      });
    },

    async findUserByEmail(email: string) {
      const valid = z.email().max(320).parse(email);
      const [row] = await db
        .select({ id: users.id, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.email, valid))
        .limit(1);
      return row;
    },

    async listTicketEvents(projectId: string, ticketId: string) {
      const validated = z
        .object({ projectId: z.uuid(), ticketId: z.uuid() })
        .parse({ projectId, ticketId });
      return db
        .select()
        .from(ticketEvents)
        .where(
          and(
            eq(ticketEvents.projectId, validated.projectId),
            eq(ticketEvents.ticketId, validated.ticketId),
          ),
        )
        .orderBy(ticketEvents.createdAt);
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
