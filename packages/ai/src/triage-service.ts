import type {
  TicketClassificationInput,
  TicketClassificationResult,
  TicketClassifier,
  TicketRoute,
  TicketType,
} from "./classifier";
import { AiError } from "./errors";
import { evaluateGitHubEscalation, routeForType } from "./policy";

export const TRIAGE_FAILED_EVENT = "triage_failed";

export interface TriageTicket {
  ticketId: string;
  projectId: string;
  workspaceId: string;
  status: string;
  message: string;
  categoryHint?: TicketClassificationInput["categoryHint"];
}

/** Narrow persistence port; implemented over the db repository boundary. */
export interface TriageRepository {
  getCurrentClassification(input: {
    workspaceId: string;
    projectId: string;
    ticketId: string;
  }): Promise<{ type: TicketType; route: TicketRoute | null } | undefined>;
  appendClassification(input: {
    workspaceId: string;
    projectId: string;
    ticketId: string;
    type: TicketType;
    severity: TicketClassificationResult["severity"];
    route: TicketRoute;
    githubIssueRecommended: boolean;
    confidence: number;
    source: "model" | "fixture";
    provider: string;
    model: string;
    reason: string | null;
  }): Promise<unknown>;
  recordTicketEvent(input: {
    projectId: string;
    ticketId: string;
    type: string;
  }): Promise<void>;
}

export type TriageOutcome =
  | {
      outcome: "classified";
      type: TicketType;
      route: TicketRoute;
      confidence: number;
      githubEligible: boolean;
    }
  | { outcome: "already-triaged"; type: TicketType }
  | { outcome: "failed"; code: AiError["code"] };

/**
 * Classify one `needs_triage` ticket and persist the validated decision.
 * Tickets in any other state, or with an existing classification, are left
 * untouched so concurrent or repeated runs converge instead of conflicting.
 * Failures record a `triage_failed` event and keep the ticket retryable.
 */
export async function triageTicket(
  repository: TriageRepository,
  classifier: TicketClassifier,
  ticket: TriageTicket,
  options: { force?: boolean } = {},
): Promise<TriageOutcome> {
  if (!options.force && ticket.status !== "needs_triage") {
    const current = await repository.getCurrentClassification({
      workspaceId: ticket.workspaceId,
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
    });
    return {
      outcome: "already-triaged",
      type: current?.type ?? "other",
    };
  }
  const existing = options.force
    ? undefined
    : await repository.getCurrentClassification({
        workspaceId: ticket.workspaceId,
        projectId: ticket.projectId,
        ticketId: ticket.ticketId,
      });
  if (existing) {
    return { outcome: "already-triaged", type: existing.type };
  }

  let result: TicketClassificationResult;
  try {
    result = await classifier.classify({
      message: ticket.message,
      categoryHint: ticket.categoryHint,
    });
  } catch (error) {
    const code = error instanceof AiError ? error.code : "AI_INVALID_RESPONSE";
    await repository.recordTicketEvent({
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: TRIAGE_FAILED_EVENT,
    });
    return { outcome: "failed", code };
  }

  const route = routeForType(result.type);
  const { eligible } = evaluateGitHubEscalation({
    type: result.type,
    route,
    confidence: result.confidence,
  });
  try {
    await repository.appendClassification({
      workspaceId: ticket.workspaceId,
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: result.type,
      severity: result.severity,
      route,
      githubIssueRecommended: eligible,
      confidence: result.confidence,
      source: result.provider === "jev" ? "model" : "fixture",
      provider: result.provider,
      model: result.model,
      reason:
        result.reason ??
        `Triage: type=${result.type} severity=${result.severity} confidence=${result.confidence}.`,
    });
  } catch {
    // A concurrent run classified first; history stays append-only and the
    // ticket state it produced is the coherent one.
    const current = await repository.getCurrentClassification({
      workspaceId: ticket.workspaceId,
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
    });
    return {
      outcome: "already-triaged",
      type: current?.type ?? result.type,
    };
  }
  return {
    outcome: "classified",
    type: result.type,
    route,
    confidence: result.confidence,
    githubEligible: eligible,
  };
}
