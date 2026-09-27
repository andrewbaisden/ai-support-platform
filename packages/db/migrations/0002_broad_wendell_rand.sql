CREATE TABLE "submission_rate_limits" (
	"project_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "submission_rate_limits_project_id_window_start_pk" PRIMARY KEY("project_id","window_start"),
	CONSTRAINT "submission_rate_limits_count_check" CHECK ("submission_rate_limits"."count" > 0)
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "category_hint" text;--> statement-breakpoint
ALTER TABLE "submission_rate_limits" ADD CONSTRAINT "submission_rate_limits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_hint_check" CHECK ("tickets"."category_hint" IS NULL OR "tickets"."category_hint" IN ('question', 'bug', 'feature_request'));