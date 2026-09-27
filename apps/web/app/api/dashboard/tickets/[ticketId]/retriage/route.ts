import {
  FixtureTicketClassifier,
  JevTicketClassifier,
  type TicketClassifier,
  type TriageRepository,
  triageTicket,
} from "@ai-support-platform/ai";
import { z } from "zod";
import {
  apiError,
  apiOk,
  requireTicketScope,
  ticketRefParamsSchema,
} from "../../../../../../lib/dashboard-api";
import { getSupportRepository } from "../../../../../../lib/support-runtime";

function triagePort(): TriageRepository {
  const repository = getSupportRepository();
  return {
    getCurrentClassification: (input) =>
      repository
        .getCurrentClassificationForProject(
          input.workspaceId,
          input.projectId,
          input.ticketId,
        )
        .then((row) =>
          row ? { type: row.type, route: row.route } : undefined,
        ),
    appendClassification: (input) =>
      repository.appendClassification(input.workspaceId, {
        projectId: input.projectId,
        ticketId: input.ticketId,
        type: input.type,
        severity: input.severity,
        route: input.route,
        githubIssueRecommended: input.githubIssueRecommended,
        confidence: input.confidence,
        source: input.source,
        provider: input.provider,
        model: input.model,
        reason: input.reason,
      }),
    recordTicketEvent: (input) =>
      repository.recordTicketEvent(input).then(() => {}),
  };
}

function createClassifier(): TicketClassifier {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (apiKey) {
    return new JevTicketClassifier({
      apiKey,
      ...(process.env.TYPESAFE_DEFAULT_MODEL
        ? { model: process.env.TYPESAFE_DEFAULT_MODEL }
        : {}),
    });
  }
  return new FixtureTicketClassifier();
}

const bodySchema = z.object({ projectId: z.uuid() });

export async function POST(
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
  const ticket = await scoped.repository.getTicketForProject(
    scoped.access.workspaceId,
    body.data.projectId,
    ticketId,
  );
  if (!ticket) return apiError("NOT_FOUND", 404);
  const submission = await scoped.repository.getTicketSubmissionText(
    body.data.projectId,
    ticketId,
  );
  if (!submission) return apiError("NOT_FOUND", 404);
  await scoped.repository.recordTicketEvent({
    projectId: body.data.projectId,
    ticketId,
    type: "retriage_requested",
  });
  const outcome = await triageTicket(
    triagePort(),
    createClassifier(),
    {
      ticketId,
      projectId: body.data.projectId,
      workspaceId: scoped.access.workspaceId,
      status: ticket.status,
      message: submission.message,
      ...(submission.categoryHint
        ? { categoryHint: submission.categoryHint }
        : {}),
    },
    { force: true },
  );
  if (outcome.outcome === "failed") return apiError(outcome.code, 503);
  if (outcome.outcome === "already-triaged") {
    return apiOk(`Already classified as ${outcome.type}.`);
  }
  return apiOk(
    `Classified as ${outcome.type} (${outcome.route}, confidence ${outcome.confidence}).`,
  );
}
