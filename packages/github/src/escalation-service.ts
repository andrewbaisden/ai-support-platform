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
  route: string | null;
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
  claimIssueCreation(input: {
    workspaceId: string;
    projectId: string;
    ticketId: string;
  }): Promise<
    | { claimed: true; previousStatus: string; marker: string }
    | { claimed: false; status: string }
  >;
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
 * A durable claim allows only one request to reach GitHub creation.
 * Ambiguous outcomes reconcile but never create from an uncertain state.
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
  const route = ticket.route;
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
    (existing.issueNumber !== null ||
      existing.status === "open" ||
      existing.status === "closed")
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

  await repository.reserveIssueLink({
    workspaceId: ticket.workspaceId,
    projectId: ticket.projectId,
    ticketId: ticket.ticketId,
    reconciliationMarker: markerForTicket(
      ticket.ticketReference,
      ticket.ticketId,
    ),
  });
  const claim = await repository.claimIssueCreation({
    workspaceId: ticket.workspaceId,
    projectId: ticket.projectId,
    ticketId: ticket.ticketId,
  });
  if (!claim.claimed) {
    const linked = await repository.getIssueLink(
      ticket.workspaceId,
      ticket.projectId,
      ticket.ticketId,
    );
    if (linked?.issueNumber !== null && linked?.issueNumber !== undefined) {
      return {
        outcome: "already-linked",
        issue: { number: linked.issueNumber, url: linked.url },
      };
    }
    return { outcome: "unknown", code: "GITHUB_CREATION_UNKNOWN" };
  }
  const marker = claim.marker;
  await repository.recordEvent({
    projectId: ticket.projectId,
    ticketId: ticket.ticketId,
    type: ESCALATION_EVENTS.requested,
    summary: `Escalation to ${integration.repositoryOwner}/${integration.repositoryName} requested.`,
  });

  let tracker: IssueTrackerClient;
  try {
    tracker = await request.trackers.forInstallation(
      integration.installationId,
    );
    await tracker.verifyRepository({
      owner: integration.repositoryOwner,
      repo: integration.repositoryName,
      repositoryId: integration.repositoryId,
    });
  } catch (error) {
    const code =
      error instanceof GithubError ? error.code : "GITHUB_MISCONFIGURED";
    await repository.markIssueStatus({
      workspaceId: ticket.workspaceId,
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      status:
        claim.previousStatus === "needs_reconciliation"
          ? "needs_reconciliation"
          : "retry_required",
    });
    await repository.recordEvent({
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: ESCALATION_EVENTS.failed,
      summary: `GitHub client or repository verification failed: ${code}.`,
    });
    return { outcome: "failed", code };
  }

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
      repositoryId: integration.repositoryId,
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
      status:
        claim.previousStatus === "needs_reconciliation"
          ? "needs_reconciliation"
          : "retry_required",
    });
    await repository.recordEvent({
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: ESCALATION_EVENTS.failed,
      summary: `Reconciliation failed: ${code}.`,
    });
    return { outcome: "failed", code };
  }

  if (claim.previousStatus === "needs_reconciliation") {
    await repository.markIssueStatus({
      workspaceId: ticket.workspaceId,
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      status: "needs_reconciliation",
    });
    return { outcome: "unknown", code: "GITHUB_CREATION_UNKNOWN" };
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
    ticketId: ticket.ticketId,
    marker,
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
    const clearRejection =
      code === "GITHUB_AUTH_FAILED" ||
      code === "GITHUB_PERMISSION_DENIED" ||
      code === "GITHUB_REPOSITORY_NOT_FOUND" ||
      code === "GITHUB_RATE_LIMITED";
    // Response rejections cannot have created an issue; transport failures can.
    await repository.markIssueStatus({
      workspaceId: ticket.workspaceId,
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      status: clearRejection ? "retry_required" : "needs_reconciliation",
    });
    await repository.recordEvent({
      projectId: ticket.projectId,
      ticketId: ticket.ticketId,
      type: clearRejection
        ? ESCALATION_EVENTS.failed
        : ESCALATION_EVENTS.unknown,
      summary: clearRejection
        ? `Issue creation rejected: ${code}.`
        : `Issue creation outcome uncertain: ${code}; reconcile before further action.`,
    });
    return clearRejection
      ? { outcome: "failed", code }
      : { outcome: "unknown", code: "GITHUB_CREATION_UNKNOWN" };
  }
}
