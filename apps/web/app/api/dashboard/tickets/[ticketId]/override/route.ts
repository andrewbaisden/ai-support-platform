import { z } from "zod";
import {
  apiError,
  apiOk,
  requireTicketScope,
  ticketRefParamsSchema,
} from "../../../../../../lib/dashboard-api";
import { canTransition } from "../../../../../../lib/ticket-transitions";

const bodySchema = z.object({
  projectId: z.uuid(),
  route: z.enum(["support", "product", "engineering", "ignore"]).optional(),
  status: z.enum(["queued"]).optional(),
  githubIssueRecommended: z.boolean().optional(),
  reason: z.string().trim().min(1).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = ticketRefParamsSchema.parse(await params);
  const body = bodySchema.safeParse(
    await request.json().catch(() => undefined),
  );
  if (
    !body.success ||
    (body.data.route === undefined &&
      body.data.status === undefined &&
      body.data.githubIssueRecommended === undefined)
  ) {
    return apiError("INVALID_REQUEST", 400);
  }
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
  if (
    body.data.status !== undefined &&
    !canTransition(ticket.status, body.data.status)
  ) {
    return apiError("INVALID_TRANSITION", 422);
  }
  const eventType =
    ticket.status === "quarantined" && body.data.status === "queued"
      ? "released_from_quarantine"
      : "rerouted";
  await scoped.repository.recordTicketOverride(
    scoped.access.workspaceId,
    {
      projectId: body.data.projectId,
      ticketId,
      decidedBy: scoped.userId,
      ...(body.data.route !== undefined ? { route: body.data.route } : {}),
      ...(body.data.status !== undefined ? { status: body.data.status } : {}),
      ...(body.data.githubIssueRecommended !== undefined
        ? { githubIssueRecommended: body.data.githubIssueRecommended }
        : {}),
      reason: body.data.reason,
    },
    eventType,
  );
  return apiOk("Review decision recorded.");
}
