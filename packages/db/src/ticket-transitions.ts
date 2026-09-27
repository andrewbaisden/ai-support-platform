import type { TicketStatus } from "./schema";

/** Shared workflow guard for operator and webhook status changes. */
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
      return (
        from === "resolved" || from === "quarantined" || from === "needs_triage"
      );
    case "quarantined":
      return from === "needs_triage" || from === "queued";
    default:
      return false;
  }
}
