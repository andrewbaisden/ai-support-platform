import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  classificationSources,
  severities,
  ticketRoutes,
  ticketTypes,
} from "./schema";

const originSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.origin === value
  );
});

export const projectInputSchema = z.object({
  workspaceId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  publicKey: z.string().regex(/^pk_[A-Za-z0-9_-]{32}$/),
  allowedOrigins: z.array(originSchema).max(20).default([]),
});

export const submissionInputSchema = z.object({
  projectId: z.uuid(),
  message: z
    .string()
    .min(1)
    .max(10_000)
    .refine((value) => value.trim().length > 0),
  visitorName: z.string().trim().max(120).optional(),
  visitorEmail: z.email().max(320).optional(),
  submissionKey: z.uuid(),
  requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  categoryHint: z.enum(["question", "bug", "feature_request"]).optional(),
});

export const classificationInputSchema = z.object({
  projectId: z.uuid(),
  ticketId: z.uuid(),
  type: z.enum(ticketTypes),
  severity: z.enum(severities),
  route: z.enum(ticketRoutes),
  githubIssueRecommended: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(),
  source: z.enum(classificationSources),
  provider: z.string().trim().min(1).max(100).nullable().default(null),
  model: z.string().trim().min(1).max(100).nullable().default(null),
  reason: z.string().trim().max(1000).nullable().default(null),
});

export const workspaceMemberInputSchema = z.object({
  workspaceId: z.uuid(),
  userId: z.string().trim().min(1).max(128),
  role: z.enum(["owner", "member"]).default("member"),
});

export const ticketOverrideInputSchema = z
  .object({
    projectId: z.uuid(),
    ticketId: z.uuid(),
    decidedBy: z.string().trim().min(1).max(128),
    route: z.enum(ticketRoutes).optional(),
    status: z
      .enum([
        "needs_triage",
        "queued",
        "escalation_pending",
        "escalated",
        "resolved",
        "quarantined",
      ])
      .optional(),
    githubIssueRecommended: z.boolean().optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(
    (value) =>
      value.route !== undefined ||
      value.status !== undefined ||
      value.githubIssueRecommended !== undefined,
    { message: "Override must change route, status, or escalation" },
  );

export type ProjectInput = z.input<typeof projectInputSchema>;
export type SubmissionInput = z.input<typeof submissionInputSchema>;
export type ClassificationInput = z.input<typeof classificationInputSchema>;
export type WorkspaceMemberInput = z.input<typeof workspaceMemberInputSchema>;
export type TicketOverrideInput = z.input<typeof ticketOverrideInputSchema>;

export function generatePublicProjectKey() {
  return `pk_${randomBytes(24).toString("base64url")}`;
}
