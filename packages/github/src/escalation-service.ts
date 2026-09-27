import {
  evaluateGitHubEscalation,
  GITHUB_ESCALATION_CONFIDENCE_THRESHOLD,
} from "@ai-support-platform/ai";
import { buildIssueDraft, labelsFor, markerForTicket } from "./draft";
import { GithubError } from "./errors";
import { screenReport } from "./privacy";
import type { CreatedIssue, IssueTrackerClient, TrackerFactory } from "./types";

export const ESCALATION_EVENTS = {
  requested: "github_escalation_requested",
  created: "github_issue_created",
  failed: "github_issue_creation_failed",
  unknown: "github_issue_creation_unknown",
  blocked: "github_escalation_blocked",
} as const;

export interface EscalationTicket {
  ticketId: string;
  projectId: string;
  workspaceId: string;
  ticketNumber: number;
  ticketReference: string;
  status: string;
  reportedAt: Date;
  message: string;
  categoryHint: string | null;
  classification: {
    type: string;
    severity: "low" | "medium" | "high" | "critical";
    confidence: number | null;
    route: string | null;
    githubIssueRecommended: boolean;
  } | null;
  override: {
    route: string | null;
    githubIssueRecommended: boolean | null;
  } | null;
}

export interface EscalationIntegration {
  installationId: string;
  repositoryId: string;
  repositoryOwner: string;
  repositoryName: string;
  status: string;
}

export interface EscalationIssueLink {
  status: string;
  issueNumber: number | null;
  url: string | null;
}

/** Narrow persistence port; implemented over the db repository boundary. */
export interface EscalationRepository {
  getIntegration(
    workspaceId: string,
    projectId: string,
  ): Promise<EscalationIntegration | undefined>;
  getIssueLink(
    workspaceId: string,
    projectId: string,
    ticketId: string,
  ): Promise<EscalationIssueLink | undefined>;
  reserveIssueLink(input: {
    workspaceId: string;
    projectId: string;
    ticketId: string;
    reconciliationMarker: string;
  }): Promise<void>;
  confirmIssueLink(input: {
    workspaceId: string;
    projectId: string;
    ticketId: string;
    githubIssueId: bigint;
    issueNumber: number;
    url: string;
  }): Promise<void>;
  markIssueStatus(input: {
    workspaceId: string;
    projectId: string;
    ticketId: string;
    status: "pending" | "retry_required" | "needs_reconciliation";
  }): Promise<void>;
  recordEvent(input: {
    projectId: string;
    ticketId: string;
    type: string;
    summary?: string;
  }): Promise<void>;
}

export type EscalationOutcome =
  | { outcome: "created"; issue: CreatedIssue }
  | {
      outcome: "already-linked";
      issue: { number: number | null; url: string | null };
    }
  | { outcome: "reconciled"; issue: CreatedIssue }
  | {
      outcome: "blocked";
      code: "GITHUB_PRIVACY_BLOCKED" | "GITHUB_BLOCKED" | "GITHUB_NOT_ELIGIBLE";
      reasons: string[];
    }
  | { outcome: "not-configured" }
  | { outcome: "failed"; code: GithubError["code"] }
  | { outcome: "unknown"; code: "GITHUB_CREATION_UNKNOWN" };

export interface EscalationRequest {
  repository: EscalationRepository;
  trackers: TrackerFactory;
  ticket: EscalationTicket;
}

/**
 * Create one GitHub issue for an eligible ticket. Every attempt reconciles
 * by marker before creating, so retries and double-clicks converge instead
 * of duplicating. Human overrides win over AI recommendations.
 */
export async function escalateTicketToGitHub(
  request: EscalationRequest,
): Promise<EscalationOutcome> {
  const { repository, ticket } = request;

  const integration = await repository.getIntegration(
    ticket.workspaceId,
    ticket.projectId,
  );
  if (integration?.status !== "active") {
    return { outcome: "not-configured" };
  }

  const classification = ticket.classification;
  if (!classification || ticket.status !== "queued") {
    return {
      outcome: "blocked",
      code: "GITHUB_NOT_ELIGIBLE",
      reasons: ["ticket is not a classified queued ticket"],
    };
  }
  const route = ticket.override?.route ?? classification.route;
  const recommended =
    ticket.override?.githubIssueRecommended ??
    classification.githubIssueRecommended;
  if (ticket.override?.githubIssueRecommended === false) {
    await repository.recordEvent({
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: ESCALATION_EVENTS.blocked,
      summary: "Owner override declined GitHub escalation.",
    });
    return {
      outcome: "blocked",
      code: "GITHUB_BLOCKED",
      reasons: ["owner override declined escalation"],
    };
  }
  const eligible =
    classification.type === "bug" &&
    route === "engineering" &&
    recommended &&
    evaluateGitHubEscalation({
      type: "bug",
      route: "engineering",
      confidence: classification.confidence ?? 0,
    }).eligible;
  if (!eligible) {
    return {
      outcome: "blocked",
      code: "GITHUB_NOT_ELIGIBLE",
      reasons: [
        `type=${classification.type} route=${route} recommended=${recommended} confidence=${classification.confidence} threshold=${GITHUB_ESCALATION_CONFIDENCE_THRESHOLD}`,
      ],
    };
  }

  const existing = await repository.getIssueLink(
    ticket.workspaceId,
    ticket.projectId,
    ticket.ticketId,
  );
  if (
    existing &&
    (existing.issueNumber !== null || existing.status === "open")
  ) {
    return {
      outcome: "already-linked",
      issue: { number: existing.issueNumber, url: existing.url },
    };
  }

  const screen = screenReport(ticket.message);
  if (!screen.safe) {
    await repository.recordEvent({
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: ESCALATION_EVENTS.blocked,
      summary: `Privacy gate blocked escalation: ${screen.findings.join(", ")}.`,
    });
    return {
      outcome: "blocked",
      code: "GITHUB_PRIVACY_BLOCKED",
      reasons: screen.findings.map((finding) => `detected ${finding}`),
    };
  }

  let tracker: IssueTrackerClient;
  try {
    tracker = await request.trackers.forInstallation(
      integration.installationId,
    );
  } catch (error) {
    const code =
      error instanceof GithubError ? error.code : "GITHUB_MISCONFIGURED";
    await repository.recordEvent({
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: ESCALATION_EVENTS.failed,
      summary: `GitHub client failed: ${code}.`,
    });
    return { outcome: "failed", code };
  }

  const marker = markerForTicket(ticket.ticketReference);
  try {
    await repository.reserveIssueLink({
      workspaceId: ticket.workspaceId,
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      reconciliationMarker: marker,
    });
  } catch {
    // A concurrent attempt reserved first; fall through to reconcile.
  }
  await repository.recordEvent({
    projectId: ticket.projectId,
    ticketId: ticket.ticketId,
    type: ESCALATION_EVENTS.requested,
    summary: `Escalation to ${integration.repositoryOwner}/${integration.repositoryName} requested.`,
  });

  const confirm = async (
    issue: CreatedIssue,
    event: string,
    summary: string,
  ) => {
    await repository.confirmIssueLink({
      workspaceId: ticket.workspaceId,
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      githubIssueId: BigInt(issue.id),
      issueNumber: issue.number,
      url: issue.url,
    });
    await repository.recordEvent({
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: event,
      summary,
    });
  };

  try {
    const reconciled = await tracker.findIssueByMarker({
      owner: integration.repositoryOwner,
      repo: integration.repositoryName,
      marker,
    });
    if (reconciled) {
      await confirm(
        reconciled,
        ESCALATION_EVENTS.created,
        `GitHub issue #${reconciled.number} linked in ${integration.repositoryOwner}/${integration.repositoryName} (reconciled).`,
      );
      return { outcome: "reconciled", issue: reconciled };
    }
  } catch (error) {
    const code =
      error instanceof GithubError ? error.code : "GITHUB_UNAVAILABLE";
    await repository.markIssueStatus({
      workspaceId: ticket.workspaceId,
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      status: "retry_required",
    });
    await repository.recordEvent({
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: ESCALATION_EVENTS.failed,
      summary: `Reconciliation failed: ${code}.`,
    });
    return { outcome: "failed", code };
  }

  let labels: string[] = labelsFor(classification.severity);
  try {
    const existingLabels = await tracker.listLabels({
      owner: integration.repositoryOwner,
      repo: integration.repositoryName,
    });
    const available = new Set(existingLabels);
    const dropped = labels.filter((label) => !available.has(label));
    labels = labels.filter((label) => available.has(label));
    if (dropped.length > 0) {
      await repository.recordEvent({
        projectId: ticket.projectId,
        ticketId: ticket.ticketId,
        type: ESCALATION_EVENTS.requested,
        summary: `Labels not present in repository, omitted: ${dropped.join(", ")}.`,
      });
    }
  } catch {
    labels = [];
  }

  const draft = buildIssueDraft({
    ticketReference: ticket.ticketReference,
    categoryHint: ticket.categoryHint,
    message: ticket.message,
    type: classification.type,
    severity: classification.severity,
    confidence: classification.confidence ?? 0,
    route: route ?? "engineering",
    reportedAt: ticket.reportedAt,
  });

  try {
    const created = await tracker.createIssue({
      owner: integration.repositoryOwner,
      repo: integration.repositoryName,
      title: draft.title,
      body: draft.body,
      labels,
    });
    await confirm(
      created,
      ESCALATION_EVENTS.created,
      `GitHub issue #${created.number} opened in ${integration.repositoryOwner}/${integration.repositoryName}.`,
    );
    return { outcome: "created", issue: created };
  } catch (error) {
    const code =
      error instanceof GithubError ? error.code : "GITHUB_UNAVAILABLE";
    // Timeouts may have created the issue remotely: mark unknown and
    // reconcile before any retry, never blind-retry. Other transport
    // failures are retryable; the next attempt still reconciles first.
    if (code === "GITHUB_TIMEOUT") {
      await repository.markIssueStatus({
        workspaceId: ticket.workspaceId,
        projectId: ticket.projectId,
        ticketId: ticket.ticketId,
        status: "needs_reconciliation",
      });
      await repository.recordEvent({
        projectId: ticket.projectId,
        ticketId: ticket.ticketId,
        type: ESCALATION_EVENTS.unknown,
        summary:
          "Issue creation outcome unknown; reconcile before retrying, never blind-retry.",
      });
      return { outcome: "unknown", code: "GITHUB_CREATION_UNKNOWN" };
    }
    await repository.markIssueStatus({
      workspaceId: ticket.workspaceId,
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      status: "retry_required",
    });
    await repository.recordEvent({
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: ESCALATION_EVENTS.failed,
      summary: `Issue creation failed: ${code}.`,
    });
    return { outcome: "failed", code };
  }
}
