import { ticketReference } from "@ai-support-platform/db";
import {
  type EscalationRepository,
  escalateTicketToGitHub,
  previewEscalation,
  type TrackerFactory,
} from "@ai-support-platform/github";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  requireTicketScope,
  ticketRefParamsSchema,
} from "../../../../../../lib/dashboard-api";
import { createEscalationTrackers } from "../../../../../../lib/github-tracker";
import { getSupportRepository } from "../../../../../../lib/support-runtime";

function escalationPort(): EscalationRepository {
  const repository = getSupportRepository();
  return {
    getIntegration: async (workspaceId, projectId) => {
      const row = await repository.getIntegrationForProject(
        workspaceId,
        projectId,
      );
      return row
        ? {
            installationId: row.installationId.toString(),
            repositoryId: row.repositoryId.toString(),
            repositoryOwner: row.repositoryOwner,
            repositoryName: row.repositoryName,
            status: row.status,
          }
        : undefined;
    },
    getIssueLink: async (workspaceId, projectId, ticketId) => {
      const row = await repository.getGitHubIssueForTicket(
        workspaceId,
        projectId,
        ticketId,
      );
      return row
        ? { status: row.status, issueNumber: row.issueNumber, url: row.url }
        : undefined;
    },
    reserveIssueLink: async (input) => {
      const row = await repository.getIntegrationForProject(
        input.workspaceId,
        input.projectId,
      );
      if (!row) throw new Error("Integration missing for reservation");
      const existing = await repository.getGitHubIssueForTicket(
        input.workspaceId,
        input.projectId,
        input.ticketId,
      );
      if (existing) return;
      try {
        await repository.reserveGitHubIssue({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          ticketId: input.ticketId,
          integrationId: row.id,
          repositoryId: row.repositoryId,
          reconciliationMarker: input.reconciliationMarker,
        });
      } catch {
        const retry = await repository.getGitHubIssueForTicket(
          input.workspaceId,
          input.projectId,
          input.ticketId,
        );
        if (retry) return;
        throw new Error("Reservation conflict without existing link");
      }
    },
    confirmIssueLink: async (input) => {
      await repository.confirmGitHubIssue({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        ticketId: input.ticketId,
        githubIssueId: input.githubIssueId,
        issueNumber: input.issueNumber,
        url: input.url,
      });
    },
    markIssueStatus: async (input) => {
      await repository.markGitHubIssueStatus(input);
    },
    recordEvent: async (input) => {
      await repository.recordTicketEvent({
        projectId: input.projectId,
        ticketId: input.ticketId,
        type: input.type,
        ...(input.summary ? { summary: input.summary } : {}),
      });
    },
  };
}

async function escalationTicket(
  workspaceId: string,
  projectId: string,
  ticketId: string,
) {
  const repository = getSupportRepository();
  const [ticket, submission, classification, override] = await Promise.all([
    repository.getTicketForProject(workspaceId, projectId, ticketId),
    repository.getTicketSubmissionText(projectId, ticketId),
    repository.getCurrentClassificationForProject(
      workspaceId,
      projectId,
      ticketId,
    ),
    repository.getLatestOverride(workspaceId, projectId, ticketId),
  ]);
  if (!ticket || !submission) return undefined;
  return {
    ticketId,
    projectId,
    workspaceId,
    ticketNumber: ticket.ticketNumber,
    ticketReference: ticketReference(ticket.ticketNumber),
    status: ticket.status,
    reportedAt: ticket.createdAt,
    message: submission.message,
    categoryHint: submission.categoryHint,
    classification: classification
      ? {
          type: classification.type,
          severity: classification.severity,
          confidence: classification.confidence,
          route: classification.route,
          githubIssueRecommended: classification.githubIssueRecommended,
        }
      : null,
    override: override?.override
      ? {
          route: override.override.route,
          githubIssueRecommended: override.override.githubIssueRecommended,
        }
      : null,
  };
}

const bodySchema = z.object({
  projectId: z.uuid(),
  action: z.enum(["preview", "create"]),
});

async function handleGithubPost(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = ticketRefParamsSchema.parse(await params);
  const body = bodySchema.safeParse(
    await request.json().catch(() => undefined),
  );
  if (!body.success) return apiError("INVALID_REQUEST", 400);
  const scoped = await requireTicketScope(request, body.data.projectId);
  if ("error" in scoped) {
    return apiError(
      scoped.error,
      scoped.error === "UNAUTHENTICATED" ? 401 : 404,
    );
  }
  let trackers: TrackerFactory;
  try {
    trackers = createEscalationTrackers();
  } catch {
    return apiError("GITHUB_MISCONFIGURED", 503);
  }
  const repository = getSupportRepository();
  const [integration, link, ticket] = await Promise.all([
    repository.getIntegrationForProject(
      scoped.access.workspaceId,
      body.data.projectId,
    ),
    repository.getGitHubIssueForTicket(
      scoped.access.workspaceId,
      body.data.projectId,
      ticketId,
    ),
    escalationTicket(scoped.access.workspaceId, body.data.projectId, ticketId),
  ]);
  if (!ticket) return apiError("NOT_FOUND", 404);
  const preview = previewEscalation({
    ticket,
    integration: integration
      ? {
          repositoryOwner: integration.repositoryOwner,
          repositoryName: integration.repositoryName,
          status: integration.status,
        }
      : undefined,
    link: link
      ? { status: link.status, issueNumber: link.issueNumber, url: link.url }
      : undefined,
  });
  if (body.data.action === "preview" || preview.state !== "eligible") {
    return NextResponse.json({ ok: true as const, preview });
  }
  const outcome = await escalateTicketToGitHub({
    repository: escalationPort(),
    trackers,
    ticket,
  });
  if (outcome.outcome === "failed" || outcome.outcome === "unknown") {
    return apiError(
      outcome.outcome === "failed" ? outcome.code : "GITHUB_CREATION_UNKNOWN",
      503,
    );
  }
  if (outcome.outcome === "blocked" || outcome.outcome === "not-configured") {
    return apiError("GITHUB_NOT_ELIGIBLE", 422);
  }
  return NextResponse.json({ ok: true as const, outcome });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  try {
    return await handleGithubPost(request, { params });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "github_route_error",
        errorType: error instanceof Error ? error.name : "Unknown",
      }),
    );
    return apiError("GITHUB_UNAVAILABLE", 503);
  }
}
