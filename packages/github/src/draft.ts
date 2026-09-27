import type { Severity } from "@ai-support-platform/db";
import { redactEmails } from "./privacy";
import type { IssueDraft } from "./types";

export const ISSUE_LABEL_ALLOWLIST = [
  "bug",
  "severity:high",
  "severity:critical",
] as const;

const TITLE_MAX = 80;
const BODY_REPORT_MAX = 4000;

/** Stable non-sensitive marker; the SUP reference grants no access. */
export function markerForTicket(ticketReference: string): string {
  return `<!-- ai-support-ticket:${ticketReference} -->`;
}

function excerpt(message: string): string {
  const firstLine =
    message
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const redacted = redactEmails(firstLine);
  return redacted.length > TITLE_MAX
    ? `${redacted.slice(0, TITLE_MAX - 1).trimEnd()}…`
    : redacted;
}

export function labelsFor(severity: Severity): string[] {
  const labels = ["bug"];
  if (severity === "high") labels.push("severity:high");
  if (severity === "critical") labels.push("severity:critical");
  return labels.filter((label) =>
    (ISSUE_LABEL_ALLOWLIST as readonly string[]).includes(label),
  );
}

export interface DraftInput {
  ticketReference: string;
  categoryHint: string | null;
  message: string;
  type: string;
  severity: Severity;
  confidence: number;
  route: string;
  reportedAt: Date;
}

/**
 * Deterministic issue draft from trusted fields only. No generative model,
 * no contact details, no internal IDs, no classification history.
 */
export function buildIssueDraft(input: DraftInput): IssueDraft {
  const short = excerpt(input.message);
  const title = short
    ? `[${input.ticketReference}] Reported bug: ${short}`
    : `[${input.ticketReference}] Reported bug`;
  const report =
    input.message.length > BODY_REPORT_MAX
      ? `${input.message.slice(0, BODY_REPORT_MAX).trimEnd()}\n\n[truncated]`
      : input.message;
  const body = [
    "## Summary",
    "",
    "A support visitor reported a possible bug.",
    "",
    "## Report",
    "",
    report,
    "",
    "## Context",
    "",
    `- Ticket: ${input.ticketReference}`,
    `- Visitor category hint: ${input.categoryHint ?? "none"}`,
    `- AI type: ${input.type} (severity ${input.severity}, model score ${Number(input.confidence).toFixed(2)} — not a calibrated probability)`,
    `- Route: ${input.route}`,
    `- Reported: ${input.reportedAt.toISOString()}`,
    "",
    "## Support workflow",
    "",
    "Reported through the AI Support Platform. Contact details are never published.",
    "",
    markerForTicket(input.ticketReference),
    "",
  ].join("\n");
  return {
    title,
    body,
    labels: labelsFor(input.severity),
    marker: markerForTicket(input.ticketReference),
  };
}
