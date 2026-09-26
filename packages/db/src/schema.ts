import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const ticketTypes = [
  "question",
  "bug",
  "feature_request",
  "account",
  "billing",
  "feedback",
  "spam",
  "other",
] as const;
export const severities = ["low", "medium", "high", "critical"] as const;
export const ticketRoutes = [
  "support",
  "product",
  "engineering",
  "ignore",
] as const;
export const ticketStatuses = [
  "needs_triage",
  "queued",
  "escalation_pending",
  "escalated",
  "resolved",
  "quarantined",
] as const;
export const messageRoles = ["visitor", "support", "ai", "system"] as const;
export const classificationSources = [
  "model",
  "manual",
  "fallback",
  "fixture",
] as const;
export const githubIssueStatuses = [
  "pending",
  "retry_required",
  "needs_reconciliation",
  "open",
  "closed",
] as const;
export const webhookStatuses = [
  "received",
  "processed",
  "failed",
  "ignored",
] as const;

export type TicketType = (typeof ticketTypes)[number];
export type Severity = (typeof severities)[number];
export type TicketRoute = (typeof ticketRoutes)[number];
export type TicketStatus = (typeof ticketStatuses)[number];

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    publicKey: text("public_key").notNull(),
    allowedOrigins: text("allowed_origins")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status")
      .$type<"active" | "inactive">()
      .default("active")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("projects_workspace_slug_unique").on(table.workspaceId, table.slug),
    unique("projects_public_key_unique").on(table.publicKey),
    check(
      "projects_status_check",
      sql`${table.status} IN ('active', 'inactive')`,
    ),
    check(
      "projects_public_key_check",
      sql`${table.publicKey} ~ '^pk_[A-Za-z0-9_-]{32}$'`,
    ),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    visitorName: text("visitor_name"),
    visitorEmail: text("visitor_email"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("conversations_id_project_unique").on(table.id, table.projectId),
    index("conversations_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
    check(
      "conversations_name_length_check",
      sql`${table.visitorName} IS NULL OR char_length(${table.visitorName}) <= 120`,
    ),
    check(
      "conversations_email_length_check",
      sql`${table.visitorEmail} IS NULL OR char_length(${table.visitorEmail}) <= 320`,
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    role: text("role").$type<(typeof messageRoles)[number]>().notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId, table.projectId],
      foreignColumns: [conversations.id, conversations.projectId],
      name: "messages_conversation_project_fk",
    }).onDelete("restrict"),
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    check(
      "messages_role_check",
      sql`${table.role} IN ('visitor', 'support', 'ai', 'system')`,
    ),
    check(
      "messages_body_length_check",
      sql`char_length(${table.body}) BETWEEN 1 AND 10000`,
    ),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ticketNumber: bigserial("ticket_number", { mode: "number" }).notNull(),
    projectId: uuid("project_id").notNull(),
    conversationId: uuid("conversation_id").notNull(),
    submissionKey: uuid("submission_key"),
    requestFingerprint: text("request_fingerprint"),
    status: text("status")
      .$type<TicketStatus>()
      .default("needs_triage")
      .notNull(),
    route: text("route").$type<TicketRoute>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.conversationId, table.projectId],
      foreignColumns: [conversations.id, conversations.projectId],
      name: "tickets_conversation_project_fk",
    }).onDelete("restrict"),
    unique("tickets_number_unique").on(table.ticketNumber),
    unique("tickets_conversation_unique").on(table.conversationId),
    unique("tickets_id_project_unique").on(table.id, table.projectId),
    unique("tickets_submission_unique").on(
      table.projectId,
      table.submissionKey,
    ),
    index("tickets_project_created_idx").on(table.projectId, table.createdAt),
    check(
      "tickets_submission_pair_check",
      sql`(${table.submissionKey} IS NULL AND ${table.requestFingerprint} IS NULL) OR (${table.submissionKey} IS NOT NULL AND ${table.requestFingerprint} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "tickets_status_check",
      sql`${table.status} IN ('needs_triage', 'queued', 'escalation_pending', 'escalated', 'resolved', 'quarantined')`,
    ),
    check(
      "tickets_route_check",
      sql`${table.route} IS NULL OR ${table.route} IN ('support', 'product', 'engineering', 'ignore')`,
    ),
  ],
);

export const ticketClassifications = pgTable(
  "ticket_classifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    classificationNumber: bigserial("classification_number", {
      mode: "number",
    }).notNull(),
    projectId: uuid("project_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    type: text("type").$type<TicketType>().notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    route: text("route").$type<TicketRoute>().notNull(),
    githubIssueRecommended: boolean("github_issue_recommended").notNull(),
    confidence: numeric("confidence", {
      precision: 5,
      scale: 4,
      mode: "number",
    }),
    source: text("source")
      .$type<(typeof classificationSources)[number]>()
      .notNull(),
    provider: text("provider"),
    model: text("model"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.ticketId, table.projectId],
      foreignColumns: [tickets.id, tickets.projectId],
      name: "classifications_ticket_project_fk",
    }).onDelete("restrict"),
    index("classifications_ticket_created_idx").on(
      table.ticketId,
      table.createdAt,
    ),
    unique("classifications_number_unique").on(table.classificationNumber),
    check(
      "classifications_type_check",
      sql`${table.type} IN ('question', 'bug', 'feature_request', 'account', 'billing', 'feedback', 'spam', 'other')`,
    ),
    check(
      "classifications_severity_check",
      sql`${table.severity} IN ('low', 'medium', 'high', 'critical')`,
    ),
    check(
      "classifications_route_check",
      sql`${table.route} IN ('support', 'product', 'engineering', 'ignore')`,
    ),
    check(
      "classifications_source_check",
      sql`${table.source} IN ('model', 'manual', 'fallback', 'fixture')`,
    ),
    check(
      "classifications_confidence_check",
      sql`${table.confidence} IS NULL OR ${table.confidence} BETWEEN 0 AND 1`,
    ),
    check(
      "classifications_reason_length_check",
      sql`${table.reason} IS NULL OR char_length(${table.reason}) <= 1000`,
    ),
  ],
);

export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    type: text("type").notNull(),
    summary: text("summary"),
    createdAt: createdAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.ticketId, table.projectId],
      foreignColumns: [tickets.id, tickets.projectId],
      name: "ticket_events_ticket_project_fk",
    }).onDelete("restrict"),
    index("ticket_events_ticket_created_idx").on(
      table.ticketId,
      table.createdAt,
    ),
    check(
      "ticket_events_type_length_check",
      sql`char_length(${table.type}) BETWEEN 1 AND 80`,
    ),
    check(
      "ticket_events_summary_length_check",
      sql`${table.summary} IS NULL OR char_length(${table.summary}) <= 500`,
    ),
  ],
);

export const githubIntegrations = pgTable(
  "github_integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "restrict" }),
    installationId: bigint("installation_id", { mode: "bigint" }).notNull(),
    repositoryId: bigint("repository_id", { mode: "bigint" }).notNull(),
    repositoryOwner: text("repository_owner").notNull(),
    repositoryName: text("repository_name").notNull(),
    status: text("status")
      .$type<"active" | "disconnected">()
      .default("active")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("github_integrations_project_unique").on(table.projectId),
    unique("github_integrations_identity_unique").on(
      table.id,
      table.projectId,
      table.repositoryId,
    ),
    check(
      "github_integrations_status_check",
      sql`${table.status} IN ('active', 'disconnected')`,
    ),
    check(
      "github_integrations_ids_check",
      sql`${table.installationId} > 0 AND ${table.repositoryId} > 0`,
    ),
  ],
);

export const githubIssues = pgTable(
  "github_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    ticketId: uuid("ticket_id").notNull(),
    integrationId: uuid("integration_id").notNull(),
    repositoryId: bigint("repository_id", { mode: "bigint" }).notNull(),
    reconciliationMarker: text("reconciliation_marker").notNull(),
    githubIssueId: bigint("github_issue_id", { mode: "bigint" }),
    issueNumber: integer("issue_number"),
    url: text("url"),
    status: text("status")
      .$type<(typeof githubIssueStatuses)[number]>()
      .default("pending")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    foreignKey({
      columns: [table.ticketId, table.projectId],
      foreignColumns: [tickets.id, tickets.projectId],
      name: "github_issues_ticket_project_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.integrationId, table.projectId, table.repositoryId],
      foreignColumns: [
        githubIntegrations.id,
        githubIntegrations.projectId,
        githubIntegrations.repositoryId,
      ],
      name: "github_issues_integration_project_repository_fk",
    }).onDelete("restrict"),
    unique("github_issues_ticket_unique").on(table.ticketId),
    unique("github_issues_marker_unique").on(table.reconciliationMarker),
    unique("github_issues_remote_unique").on(
      table.repositoryId,
      table.githubIssueId,
    ),
    check(
      "github_issues_status_check",
      sql`${table.status} IN ('pending', 'retry_required', 'needs_reconciliation', 'open', 'closed')`,
    ),
    check(
      "github_issues_number_check",
      sql`${table.issueNumber} IS NULL OR ${table.issueNumber} > 0`,
    ),
    check(
      "github_issues_remote_pair_check",
      sql`(${table.githubIssueId} IS NULL AND ${table.issueNumber} IS NULL AND ${table.url} IS NULL AND ${table.status} IN ('pending', 'retry_required', 'needs_reconciliation')) OR (${table.githubIssueId} IS NOT NULL AND ${table.issueNumber} IS NOT NULL AND ${table.url} IS NOT NULL AND ${table.status} IN ('open', 'closed'))`,
    ),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").default("github").notNull(),
    deliveryId: text("delivery_id").notNull(),
    eventType: text("event_type").notNull(),
    action: text("action"),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "restrict",
    }),
    installationId: bigint("installation_id", { mode: "bigint" }),
    repositoryId: bigint("repository_id", { mode: "bigint" }),
    githubIssueId: bigint("github_issue_id", { mode: "bigint" }),
    status: text("status")
      .$type<(typeof webhookStatuses)[number]>()
      .default("received")
      .notNull(),
    failureCode: text("failure_code"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    unique("webhook_events_provider_delivery_unique").on(
      table.provider,
      table.deliveryId,
    ),
    index("webhook_events_status_received_idx").on(
      table.status,
      table.receivedAt,
    ),
    check("webhook_events_provider_check", sql`${table.provider} = 'github'`),
    check(
      "webhook_events_status_check",
      sql`${table.status} IN ('received', 'processed', 'failed', 'ignored')`,
    ),
    check(
      "webhook_events_failure_code_length_check",
      sql`${table.failureCode} IS NULL OR char_length(${table.failureCode}) <= 80`,
    ),
  ],
);
