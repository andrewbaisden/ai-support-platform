import type { TicketStatus } from "@ai-support-platform/db";
import { z } from "zod";
import {
  apiError,
  apiOk,
  requireTicketScope,
  scopeErrorResponse,
  ticketRefParamsSchema,
} from "../../../../../../lib/dashboard-api";
import {
  canTransition,
  transitionEvent,
} from "../../../../../../lib/ticket-transitions";

const bodySchema = z.object({
  projectId: z.uuid(),
  to: z.enum(["resolved", "queued"]),
});

const allowedTargets: Record<"resolved" | "queued", TicketStatus[]> = {
  resolved: ["needs_triage", "queued", "quarantined", "escalation_pending"],
  queued: ["resolved", "quarantined", "needs_triage"],
};

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
  if ("error" in scoped) return scopeErrorResponse(scoped.error);
  const ticket = await scoped.repository.getTicketForProject(
    scoped.access.workspaceId,
    body.data.projectId,
    ticketId,
  );
  if (!ticket) return apiError("NOT_FOUND", 404);
  if (
    !allowedTargets[body.data.to].includes(ticket.status) ||
    !canTransition(ticket.status, body.data.to)
  ) {
    return apiError("INVALID_TRANSITION", 422);
  }
  await scoped.repository.updateTicketStatus(scoped.access.workspaceId, {
    projectId: body.data.projectId,
    ticketId,
    status: body.data.to,
    eventType: transitionEvent(ticket.status, body.data.to),
  });
  return apiOk(`Ticket moved to ${body.data.to}.`);
}
