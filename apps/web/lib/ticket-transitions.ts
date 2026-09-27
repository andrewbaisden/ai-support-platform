import { canTransition, type TicketStatus } from "@ai-support-platform/db";

export { canTransition };

/**
 * Owner-driven workflow transitions. AI triage owns needs_triage→queued and
 * →quarantined via appendClassification; escalation states belong to the
 * future GitHub phase and are never entered manually. Anything not listed
 * here is rejected server-side.
 */
export function transitionEvent(
  from: TicketStatus,
  to: TicketStatus,
): "resolved" | "reopened" | "released_from_quarantine" | "rerouted" {
  if (to === "resolved") return "resolved";
  if (from === "resolved" && to === "queued") return "reopened";
  if (from === "quarantined" && to === "queued")
    return "released_from_quarantine";
  return "rerouted";
}
