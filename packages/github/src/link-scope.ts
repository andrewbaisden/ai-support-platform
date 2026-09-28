import type { IssueLinkScope } from "@ai-support-platform/db";
import type { WebhookTransaction } from "./webhook-service";

/**
 * Adapt the db package's locked issue-link scope to the webhook policy's
 * transaction port. Pure mapping: no queries of its own. Used by the webhook
 * route, remote-state sync after escalation, CLIs, and tests alike.
 */
export function webhookTransactionFromScope(
  scope: IssueLinkScope,
): WebhookTransaction {
  let found: { issueId: string; ticketId: string } | undefined;
  return {
    findLink: async (ref) => {
      const row = await scope.findLink({
        repositoryId: BigInt(ref.repositoryId),
        githubIssueId: BigInt(ref.githubIssueId),
      });
      if (!row) return undefined;
      found = { issueId: row.issueId, ticketId: row.ticketId };
      return {
        ticketId: row.ticketId,
        projectId: row.projectId,
        workspaceId: row.workspaceId,
        issueNumber: row.issueNumber,
        installationId: row.installationId.toString(),
        integrationStatus: row.integrationStatus,
        linkStatus: row.linkStatus,
        ticketStatus: row.ticketStatus,
        ticketRoute: row.ticketRoute,
        ...(row.latestStatusEvent
          ? { latestStatusEvent: row.latestStatusEvent }
          : {}),
        ...(row.remoteUpdatedAt
          ? { remoteUpdatedAt: row.remoteUpdatedAt.toISOString() }
          : {}),
      };
    },
    setIssueState: async (link, state, remoteUpdatedAt) => {
      // Only the row locked by findLink in this transaction may change.
      if (!found || found.ticketId !== link.ticketId) {
        throw new Error("Issue link not locked in this transaction");
      }
      await scope.setIssueState(
        found.issueId,
        state,
        remoteUpdatedAt ? new Date(remoteUpdatedAt) : undefined,
      );
    },
    setTicketStatus: (link, status, eventType, summary) =>
      scope.setTicketStatus(link.ticketId, status, eventType, summary),
    recordEvent: (link, type, summary) =>
      scope.recordEvent(link.projectId, link.ticketId, type, summary),
  };
}
