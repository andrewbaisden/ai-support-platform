CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"visitor_name" text,
	"visitor_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "conversations_name_length_check" CHECK ("conversations"."visitor_name" IS NULL OR char_length("conversations"."visitor_name") <= 120),
	CONSTRAINT "conversations_email_length_check" CHECK ("conversations"."visitor_email" IS NULL OR char_length("conversations"."visitor_email") <= 320)
);
--> statement-breakpoint
CREATE TABLE "github_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"installation_id" bigint NOT NULL,
	"repository_id" bigint NOT NULL,
	"repository_owner" text NOT NULL,
	"repository_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_integrations_project_unique" UNIQUE("project_id"),
	CONSTRAINT "github_integrations_identity_unique" UNIQUE("id","project_id","repository_id"),
	CONSTRAINT "github_integrations_status_check" CHECK ("github_integrations"."status" IN ('active', 'disconnected')),
	CONSTRAINT "github_integrations_ids_check" CHECK ("github_integrations"."installation_id" > 0 AND "github_integrations"."repository_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "github_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"repository_id" bigint NOT NULL,
	"reconciliation_marker" text NOT NULL,
	"github_issue_id" bigint,
	"issue_number" integer,
	"url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_issues_ticket_unique" UNIQUE("ticket_id"),
	CONSTRAINT "github_issues_marker_unique" UNIQUE("reconciliation_marker"),
	CONSTRAINT "github_issues_remote_unique" UNIQUE("repository_id","github_issue_id"),
	CONSTRAINT "github_issues_status_check" CHECK ("github_issues"."status" IN ('pending', 'retry_required', 'needs_reconciliation', 'open', 'closed')),
	CONSTRAINT "github_issues_number_check" CHECK ("github_issues"."issue_number" IS NULL OR "github_issues"."issue_number" > 0),
	CONSTRAINT "github_issues_remote_pair_check" CHECK (("github_issues"."github_issue_id" IS NULL AND "github_issues"."issue_number" IS NULL AND "github_issues"."url" IS NULL AND "github_issues"."status" IN ('pending', 'retry_required', 'needs_reconciliation')) OR ("github_issues"."github_issue_id" IS NOT NULL AND "github_issues"."issue_number" IS NOT NULL AND "github_issues"."url" IS NOT NULL AND "github_issues"."status" IN ('open', 'closed')))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_role_check" CHECK ("messages"."role" IN ('visitor', 'support', 'ai', 'system')),
	CONSTRAINT "messages_body_length_check" CHECK (char_length("messages"."body") BETWEEN 1 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"public_key" text NOT NULL,
	"allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_workspace_slug_unique" UNIQUE("workspace_id","slug"),
	CONSTRAINT "projects_public_key_unique" UNIQUE("public_key"),
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" IN ('active', 'inactive')),
	CONSTRAINT "projects_public_key_check" CHECK ("projects"."public_key" ~ '^pk_[A-Za-z0-9_-]{32}$')
);
--> statement-breakpoint
CREATE TABLE "ticket_classifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"route" text NOT NULL,
	"github_issue_recommended" boolean NOT NULL,
	"confidence" numeric(5, 4),
	"source" text NOT NULL,
	"provider" text,
	"model" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classifications_type_check" CHECK ("ticket_classifications"."type" IN ('question', 'bug', 'feature_request', 'account', 'billing', 'feedback', 'spam', 'other')),
	CONSTRAINT "classifications_severity_check" CHECK ("ticket_classifications"."severity" IN ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "classifications_route_check" CHECK ("ticket_classifications"."route" IN ('support', 'product', 'engineering', 'ignore')),
	CONSTRAINT "classifications_source_check" CHECK ("ticket_classifications"."source" IN ('model', 'manual', 'fallback', 'fixture')),
	CONSTRAINT "classifications_confidence_check" CHECK ("ticket_classifications"."confidence" IS NULL OR "ticket_classifications"."confidence" BETWEEN 0 AND 1),
	CONSTRAINT "classifications_reason_length_check" CHECK ("ticket_classifications"."reason" IS NULL OR char_length("ticket_classifications"."reason") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "ticket_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"type" text NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_events_type_length_check" CHECK (char_length("ticket_events"."type") BETWEEN 1 AND 80),
	CONSTRAINT "ticket_events_summary_length_check" CHECK ("ticket_events"."summary" IS NULL OR char_length("ticket_events"."summary") <= 500)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_number" bigserial NOT NULL,
	"project_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"submission_key" uuid,
	"request_fingerprint" text,
	"status" text DEFAULT 'needs_triage' NOT NULL,
	"route" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_number_unique" UNIQUE("ticket_number"),
	CONSTRAINT "tickets_conversation_unique" UNIQUE("conversation_id"),
	CONSTRAINT "tickets_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "tickets_submission_unique" UNIQUE("project_id","submission_key"),
	CONSTRAINT "tickets_submission_pair_check" CHECK (("tickets"."submission_key" IS NULL AND "tickets"."request_fingerprint" IS NULL) OR ("tickets"."submission_key" IS NOT NULL AND "tickets"."request_fingerprint" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "tickets_status_check" CHECK ("tickets"."status" IN ('needs_triage', 'queued', 'escalation_pending', 'escalated', 'resolved', 'quarantined')),
	CONSTRAINT "tickets_route_check" CHECK ("tickets"."route" IS NULL OR "tickets"."route" IN ('support', 'product', 'engineering', 'ignore'))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"action" text,
	"project_id" uuid,
	"installation_id" bigint,
	"repository_id" bigint,
	"github_issue_id" bigint,
	"status" text DEFAULT 'received' NOT NULL,
	"failure_code" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_provider_delivery_unique" UNIQUE("provider","delivery_id"),
	CONSTRAINT "webhook_events_provider_check" CHECK ("webhook_events"."provider" = 'github'),
	CONSTRAINT "webhook_events_status_check" CHECK ("webhook_events"."status" IN ('received', 'processed', 'failed', 'ignored')),
	CONSTRAINT "webhook_events_failure_code_length_check" CHECK ("webhook_events"."failure_code" IS NULL OR char_length("webhook_events"."failure_code") <= 80)
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issues" ADD CONSTRAINT "github_issues_ticket_project_fk" FOREIGN KEY ("ticket_id","project_id") REFERENCES "public"."tickets"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_issues" ADD CONSTRAINT "github_issues_integration_project_repository_fk" FOREIGN KEY ("integration_id","project_id","repository_id") REFERENCES "public"."github_integrations"("id","project_id","repository_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_project_fk" FOREIGN KEY ("conversation_id","project_id") REFERENCES "public"."conversations"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_classifications" ADD CONSTRAINT "classifications_ticket_project_fk" FOREIGN KEY ("ticket_id","project_id") REFERENCES "public"."tickets"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_project_fk" FOREIGN KEY ("ticket_id","project_id") REFERENCES "public"."tickets"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_conversation_project_fk" FOREIGN KEY ("conversation_id","project_id") REFERENCES "public"."conversations"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_project_created_idx" ON "conversations" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "classifications_ticket_created_idx" ON "ticket_classifications" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_created_idx" ON "ticket_events" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_project_created_idx" ON "tickets" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_events_status_received_idx" ON "webhook_events" USING btree ("status","received_at");