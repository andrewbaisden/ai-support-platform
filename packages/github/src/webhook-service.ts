export const WEBHOOK_EVENTS = {
  issueClosed: "github_issue_closed",
  resolvedFromGithub: "ticket_resolved_from_github",
  issueReopened: "github_issue_reopened",
  reopenedFromGithub: "ticket_reopened_from_github",
} as const;

export interface WebhookDeliveryInput {
  deliveryId: string;
  eventType: string;
  action?: string;
  repositoryId?: string;
  installationId?: string;
  githubIssueId?: string;
}

export interface RemoteIssueRef {
  repositoryId: string;
  githubIssueId: string;
  issueNumber: number;
  issueState: "open" | "closed";
}

export interface WebhookLink {
  ticketId: string;
  projectId: string;
  workspaceId: string;
  issueNumber: number;
  installationId: string;
  integrationStatus: string;
  linkStatus: string;
  ticketStatus: string;
  ticketRoute: string | null;
  latestStatusEvent?: string;
}

export type WebhookOutcome =
  | { outcome: "processed"; detail: string }
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string };
type ProcessedOutcome = Exclude<WebhookOutcome, { outcome: "duplicate" }>;

export interface WebhookTransaction {
  findLink(ref: RemoteIssueRef): Promise<WebhookLink | undefined>;
  setIssueState(link: WebhookLink, state: "open" | "closed"): Promise<void>;
  setTicketStatus(
    link: WebhookLink,
    status: "queued" | "resolved",
    eventType: string,
    summary: string,
  ): Promise<void>;
  recordEvent(link: WebhookLink, type: string, summary: string): Promise<void>;
}

export interface WebhookRepository {
  withDelivery(
    delivery: WebhookDeliveryInput,
    process: (tx: WebhookTransaction) => Promise<ProcessedOutcome>,
  ): Promise<WebhookOutcome>;
}

/** One delivery and all resulting domain changes commit together. */
export function processGitHubWebhook(
  repository: WebhookRepository,
  input: {
    delivery: WebhookDeliveryInput;
    action: "closed" | "reopened" | "ignored" | "ping";
    issue?: RemoteIssueRef;
    installationId?: string;
    ignoredReason?: string;
  },
): Promise<WebhookOutcome> {
  return repository.withDelivery(input.delivery, async (tx) => {
    if (input.action === "ping")
      return { outcome: "processed", detail: "ping" };
    if (input.action === "ignored") {
      return {
        outcome: "ignored",
        reason: input.ignoredReason ?? "unsupported_action",
      };
    }
    const issue = input.issue;
    if (
      !issue ||
      issue.issueState !== (input.action === "closed" ? "closed" : "open")
    ) {
      return { outcome: "ignored", reason: "state_mismatch" };
    }
    const link = await tx.findLink(issue);
    if (!link) return { outcome: "ignored", reason: "unknown_issue" };
    if (
      link.issueNumber !== issue.issueNumber ||
      link.installationId !== input.installationId ||
      link.integrationStatus !== "active"
    ) {
      return { outcome: "ignored", reason: "identity_mismatch" };
    }
    // Semantic repeats under new delivery IDs cannot undo a later human decision.
    if (link.linkStatus === issue.issueState) {
      return { outcome: "processed", detail: "already_current" };
    }
    await tx.setIssueState(link, issue.issueState);
    if (input.action === "closed") {
      await tx.recordEvent(
        link,
        WEBHOOK_EVENTS.issueClosed,
        `GitHub issue #${issue.issueNumber} closed.`,
      );
      if (
        link.ticketStatus === "queued" &&
        link.ticketRoute === "engineering"
      ) {
        await tx.setTicketStatus(
          link,
          "resolved",
          WEBHOOK_EVENTS.resolvedFromGithub,
          `Resolved because GitHub issue #${issue.issueNumber} closed.`,
        );
      }
      return { outcome: "processed", detail: "closed" };
    }
    await tx.recordEvent(
      link,
      WEBHOOK_EVENTS.issueReopened,
      `GitHub issue #${issue.issueNumber} reopened.`,
    );
    if (
      link.ticketStatus === "resolved" &&
      link.latestStatusEvent === WEBHOOK_EVENTS.resolvedFromGithub
    ) {
      await tx.setTicketStatus(
        link,
        "queued",
        WEBHOOK_EVENTS.reopenedFromGithub,
        `Reopened because GitHub issue #${issue.issueNumber} reopened.`,
      );
    }
    return { outcome: "processed", detail: "reopened" };
  });
}
