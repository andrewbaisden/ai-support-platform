import {
  evaluateGitHubEscalation,
  GITHUB_ESCALATION_CONFIDENCE_THRESHOLD,
} from "@ai-support-platform/ai";
import { buildIssueDraft } from "./draft";
import { type SubmittedContact, screenReport } from "./privacy";
import { provenanceBlock } from "./provenance";
import type { IssueDraft } from "./types";

export interface PreviewTicket {
  ticketId: string;
  ticketReference: string;
  status: string;
  route: string | null;
  reportedAt: Date;
  message: string;
  categoryHint: string | null;
  /** Private submitted contact, used only to screen the report; never drafted. */
  contact: SubmittedContact | null;
  classification: {
    type: string;
    severity: "low" | "medium" | "high" | "critical";
    confidence: number | null;
    route: string | null;
    githubIssueRecommended: boolean;
    /** Classification provenance: model, manual, fallback, or fixture. */
    source: string;
  } | null;
  override: {
    route: string | null;
    githubIssueRecommended: boolean | null;
  } | null;
}

export interface PreviewIntegration {
  repositoryOwner: string;
  repositoryName: string;
  status: string;
}

export interface PreviewLink {
  status: string;
  issueNumber: number | null;
  url: string | null;
}

export type EscalationPreview =
  | { state: "not-configured" }
  | {
      state: "blocked";
      code: "GITHUB_PRIVACY_BLOCKED" | "GITHUB_BLOCKED" | "GITHUB_NOT_ELIGIBLE";
      reasons: string[];
    }
  | {
      state: "already-linked";
      issue: { number: number | null; url: string | null };
    }
  | { state: "unknown" }
  | { state: "in-progress" }
  | {
      state: "eligible";
      repository: { owner: string; repo: string };
      draft: IssueDraft;
      candidateLabels: string[];
      reasons: string[];
    };

/**
 * Side-effect-free escalation preview for operator confirmation. Mirrors the
 * service's eligibility, precedence, and privacy rules without network calls,
 * reservations, or events.
 */
export function previewEscalation(input: {
  ticket: PreviewTicket;
  integration?: PreviewIntegration | undefined;
  link?: PreviewLink | undefined;
  allowFixtureClassifications?: boolean;
}): EscalationPreview {
  const { ticket, integration, link } = input;
  if (integration?.status !== "active") {
    return { state: "not-configured" };
  }
  if (
    link &&
    (link.issueNumber !== null ||
      link.status === "open" ||
      link.status === "closed")
  ) {
    return {
      state: "already-linked",
      issue: { number: link.issueNumber, url: link.url },
    };
  }
  if (link?.status === "creating") {
    return { state: "in-progress" };
  }
  if (link?.status === "needs_reconciliation") {
    return { state: "unknown" };
  }
  const classification = ticket.classification;
  if (!classification || ticket.status !== "queued") {
    return {
      state: "blocked",
      code: "GITHUB_NOT_ELIGIBLE",
      reasons: ["ticket is not a classified queued ticket"],
    };
  }
  const route = ticket.route;
  if (ticket.override?.githubIssueRecommended === false) {
    return {
      state: "blocked",
      code: "GITHUB_BLOCKED",
      reasons: ["owner override declined escalation"],
    };
  }
  const eligible =
    classification.type === "bug" &&
    route === "engineering" &&
    (ticket.override?.githubIssueRecommended ??
      classification.githubIssueRecommended) &&
    evaluateGitHubEscalation({
      type: "bug",
      route: "engineering",
      confidence: classification.confidence ?? 0,
    }).eligible;
  if (!eligible) {
    return {
      state: "blocked",
      code: "GITHUB_NOT_ELIGIBLE",
      reasons: [
        `type=${classification.type} route=${route} confidence=${classification.confidence} threshold=${GITHUB_ESCALATION_CONFIDENCE_THRESHOLD}`,
      ],
    };
  }
  const provenance = provenanceBlock({
    source: classification.source,
    ownerRecommended: ticket.override?.githubIssueRecommended === true,
    policy: {
      allowFixtureClassifications: input.allowFixtureClassifications ?? false,
    },
  });
  if (provenance) {
    return {
      state: "blocked",
      code: "GITHUB_NOT_ELIGIBLE",
      reasons: [provenance],
    };
  }
  const screen = screenReport(ticket.message, { contact: ticket.contact });
  if (!screen.safe) {
    return {
      state: "blocked",
      code: "GITHUB_PRIVACY_BLOCKED",
      reasons: screen.findings.map((finding) => `detected ${finding}`),
    };
  }
  const draft = buildIssueDraft({
    ticketId: ticket.ticketId,
    ticketReference: ticket.ticketReference,
    categoryHint: ticket.categoryHint,
    message: ticket.message,
    type: classification.type,
    severity: classification.severity,
    confidence: classification.confidence ?? 0,
    route: route ?? "engineering",
    reportedAt: ticket.reportedAt,
  });
  return {
    state: "eligible",
    repository: {
      owner: integration.repositoryOwner,
      repo: integration.repositoryName,
    },
    draft,
    candidateLabels: draft.labels,
    reasons: [
      `type=bug route=engineering confidence=${classification.confidence}`,
    ],
  };
}
