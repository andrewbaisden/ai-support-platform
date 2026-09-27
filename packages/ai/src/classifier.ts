import type {
  Severity,
  TicketRoute,
  TicketType,
} from "@ai-support-platform/db";
import { z } from "zod";

export const ticketTypeSchema = z.enum([
  "question",
  "bug",
  "feature_request",
  "account",
  "billing",
  "feedback",
  "spam",
  "other",
]);

export const severitySchema = z.enum(["low", "medium", "high", "critical"]);

/** Minimal data sent to a classifier. Contact details never leave the platform. */
export const classificationInputSchema = z.object({
  message: z.string().min(1).max(10_000),
  categoryHint: z.enum(["question", "bug", "feature_request"]).optional(),
});

export type TicketClassificationInput = z.infer<
  typeof classificationInputSchema
>;

/**
 * Provider-neutral classification result. Route and GitHub escalation are
 * derived by application policy, not trusted model fields.
 */
export const classificationResultSchema = z.object({
  type: ticketTypeSchema,
  severity: severitySchema,
  /** Normalized confidence: provider probability of the selected type label, 0–1. */
  confidence: z.number().min(0).max(1),
  /** Deterministic audit note; Jev adapters never generate prose. */
  reason: z.string().max(1000).optional(),
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
});

export type TicketClassificationResult = z.infer<
  typeof classificationResultSchema
>;

export interface TicketClassifier {
  classify(
    input: TicketClassificationInput,
  ): Promise<TicketClassificationResult>;
}

export type { Severity, TicketRoute, TicketType };
