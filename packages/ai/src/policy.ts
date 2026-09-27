import type { TicketRoute, TicketType } from "./classifier";
import {
  GITHUB_ESCALATION_CONFIDENCE_THRESHOLD,
  LOW_CONFIDENCE_REVIEW_FLOOR,
} from "./config";

/**
 * Deterministic routing policy. Jev recommends type/severity; code owns the
 * queue. Spam is quarantined via the `ignore` route; account, billing,
 * feedback, and other stay in support/manual review until workflows exist.
 */
export function routeForType(type: TicketType): TicketRoute {
  switch (type) {
    case "bug":
      return "engineering";
    case "feature_request":
      return "product";
    case "spam":
      return "ignore";
    default:
      return "support";
  }
}

export interface EscalationEvaluation {
  eligible: boolean;
  reasons: string[];
}

/**
 * Application GitHub-escalation policy, separate from raw model output.
 * Eligibility is a stored recommendation only; issue creation starts in
 * Phase 7 and additionally requires a project integration plus publication
 * safety checks that do not exist yet.
 */
export function evaluateGitHubEscalation(input: {
  type: TicketType;
  route: TicketRoute;
  confidence: number;
}): EscalationEvaluation {
  const reasons: string[] = [];
  if (input.type !== "bug") {
    reasons.push(`type is ${input.type}, not bug`);
  }
  if (input.route !== "engineering") {
    reasons.push(`route is ${input.route}, not engineering`);
  }
  if (!(input.confidence >= GITHUB_ESCALATION_CONFIDENCE_THRESHOLD)) {
    reasons.push(
      `confidence ${input.confidence} is below ${GITHUB_ESCALATION_CONFIDENCE_THRESHOLD}`,
    );
  }
  if (input.confidence < LOW_CONFIDENCE_REVIEW_FLOOR) {
    reasons.push(
      `confidence ${input.confidence} is below the review floor ${LOW_CONFIDENCE_REVIEW_FLOOR}`,
    );
  }
  return { eligible: reasons.length === 0, reasons };
}
