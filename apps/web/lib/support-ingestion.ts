import { createHash } from "node:crypto";
import {
  SubmissionConflictError,
  ticketReference,
} from "@ai-support-platform/db";
import type { TicketSubmissionRequest } from "@ai-support-platform/support-contracts";

export interface IngestionRepository {
  getProjectByPublicKey(
    key: string,
  ): Promise<{ id: string; allowedOrigins: string[] } | undefined>;
  getSubmissionForRetry(
    projectId: string,
    submissionKey: string,
    requestFingerprint: string,
  ): Promise<{ ticketNumber: number } | undefined>;
  consumeSubmissionRateLimit(
    projectId: string,
    windowStart: Date,
    limit: number,
  ): Promise<boolean>;
  createSubmission(input: {
    projectId: string;
    categoryHint: TicketSubmissionRequest["category"];
    message: string;
    visitorName?: string;
    visitorEmail?: string;
    submissionKey: string;
    requestFingerprint: string;
  }): Promise<{ ticketNumber: number }>;
}

export type SubmissionOutcome =
  | { ok: true; ticketReference: string }
  | {
      ok: false;
      code:
        | "PROJECT_NOT_FOUND"
        | "ORIGIN_NOT_ALLOWED"
        | "RATE_LIMITED"
        | "SUBMISSION_CONFLICT";
    };

export function normalizeRequestOrigin(
  origin: string | null,
): string | null | "invalid" {
  if (origin === null) return null;
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
      return "invalid";
    return url.origin;
  } catch {
    return "invalid";
  }
}

export function submissionFingerprint(input: TicketSubmissionRequest): string {
  const value = JSON.stringify([
    1,
    input.category,
    input.message,
    input.contact?.name ?? "",
    input.contact?.email ?? "",
  ]);
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function resolveProjectOrigin(
  repository: IngestionRepository,
  projectKey: string,
  origin: string | null,
) {
  const project = await repository.getProjectByPublicKey(projectKey);
  if (!project)
    return { ok: false as const, code: "PROJECT_NOT_FOUND" as const };
  const normalized = normalizeRequestOrigin(origin);
  if (
    normalized === "invalid" ||
    (normalized && !project.allowedOrigins.includes(normalized))
  ) {
    return { ok: false as const, code: "ORIGIN_NOT_ALLOWED" as const };
  }
  return { ok: true as const, project, origin: normalized };
}

export async function submitSupportRequest(
  repository: IngestionRepository,
  input: TicketSubmissionRequest,
  projectId: string,
  now = new Date(),
): Promise<SubmissionOutcome> {
  try {
    const fingerprint = submissionFingerprint(input);
    const existing = await repository.getSubmissionForRetry(
      projectId,
      input.submissionId,
      fingerprint,
    );
    if (existing)
      return {
        ok: true,
        ticketReference: ticketReference(existing.ticketNumber),
      };
    const windowStart = new Date(
      Math.floor(now.getTime() / 3_600_000) * 3_600_000,
    );
    const allowed = await repository.consumeSubmissionRateLimit(
      projectId,
      windowStart,
      120,
    );
    if (!allowed) return { ok: false, code: "RATE_LIMITED" };
    const ticket = await repository.createSubmission({
      projectId,
      categoryHint: input.category,
      message: input.message,
      visitorName: input.contact?.name,
      visitorEmail: input.contact?.email,
      submissionKey: input.submissionId,
      requestFingerprint: fingerprint,
    });
    return { ok: true, ticketReference: ticketReference(ticket.ticketNumber) };
  } catch (error) {
    if (
      error instanceof SubmissionConflictError ||
      (error instanceof Error && error.name === "SubmissionConflictError")
    )
      return { ok: false, code: "SUBMISSION_CONFLICT" };
    throw error;
  }
}
