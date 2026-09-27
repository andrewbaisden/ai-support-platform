import type { TicketStatus } from "@ai-support-platform/db";

/**
 * Owner-driven workflow transitions. AI triage owns needs_triage→queued and
 * →quarantined via appendClassification; escalation states belong to the
 * future GitHub phase and are never entered manually. Anything not listed
 * here is rejected server-side.
 */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true;
  switch (to) {
    case "resolved":
      return (
        from === "needs_triage" ||
        from === "queued" ||
        from === "quarantined" ||
        from === "escalation_pending"
      );
    case "queued":
      // Reopen resolved tickets, or release quarantined ones via review.
      return (
        from === "resolved" || from === "quarantined" || from === "needs_triage"
      );
    case "quarantined":
      return from === "needs_triage" || from === "queued";
    default:
      return false;
  }
}

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
