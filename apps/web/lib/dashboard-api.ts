import {
  AuthRequiredError,
  requireSessionUser,
  requireWorkspaceAccess,
} from "@ai-support-platform/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupportRepository } from "./support-runtime";

export type TicketScope =
  | { error: "FORBIDDEN" | "UNAUTHENTICATED" | "NOT_FOUND" }
  | {
      userId: string;
      access: {
        workspaceId: string;
        workspaceName: string;
        role: "owner" | "member";
      };
      repository: ReturnType<
        typeof import("@ai-support-platform/db").createSupportRepository
      >;
    };

/**
 * Session + workspace gate for dashboard mutation routes. Verifies the
 * request Origin against the host for cookie-based CSRF protection and
 * resolves membership for the ticket's workspace. Returns safe error codes;
 * never leaks tenant existence beyond 404/403 equivalence with the pages.
 */
export type DashboardApiError =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "INVALID_TRANSITION";

export async function requireTicketScope(
  request: Request,
  projectId: string,
): Promise<TicketScope> {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin) {
    let allowed = false;
    try {
      allowed =
        new URL(origin).host === host &&
        new URL(origin).protocol.startsWith("http");
    } catch {
      allowed = false;
    }
    if (!allowed) {
      return { error: "FORBIDDEN" as const };
    }
  }
  let userId: string;
  try {
    userId = (await requireSessionUser(await headers())).id;
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return { error: "UNAUTHENTICATED" as const };
    }
    throw error;
  }
  const repository = getSupportRepository();
  const context = await repository.getProjectWorkspace(projectId);
  if (!context) return { error: "NOT_FOUND" as const };
  const access = await requireWorkspaceAccess(
    userId,
    context.workspaceId,
  ).catch(() => undefined);
  if (!access) return { error: "NOT_FOUND" as const };
  return { userId, access, repository };
}

export function apiError(error: DashboardApiError | string, status: number) {
  return NextResponse.json({ ok: false as const, error }, { status });
}

export function apiOk(message: string) {
  return NextResponse.json({ ok: true as const, message });
}

export const ticketRefParamsSchema = z.object({
  ticketId: z.uuid(),
});
