ALTER TABLE "ticket_events" ADD COLUMN "event_number" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_overrides" ADD COLUMN "decision_number" bigserial NOT NULL;