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
  | { error: ScopeError }
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

export type ScopeError =
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "OWNER_REQUIRED";

export type DashboardApiError =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "INVALID_TRANSITION";

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return url.host === host && /^https?:$/.test(url.protocol);
  } catch {
    return false;
  }
}

/**
 * Session + workspace gate for dashboard mutation routes. Every mutation
 * must carry a same-origin `Origin` header (browsers send it on fetch POSTs),
 * so cookie-authenticated requests cannot be forged cross-site even if the
 * cookie policy changes. Resolves membership for the ticket's workspace and,
 * for publishing actions, requires the owner role. Returns safe error codes;
 * never leaks tenant existence beyond 404 equivalence with the pages.
 */
export async function requireTicketScope(
  request: Request,
  projectId: string,
  options: { requireOwner?: boolean } = {},
): Promise<TicketScope> {
  if (!isSameOrigin(request)) {
    return { error: "FORBIDDEN" as const };
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
  if (options.requireOwner && access.role !== "owner") {
    return { error: "OWNER_REQUIRED" as const };
  }
  return { userId, access, repository };
}

/** Safe HTTP mapping: members learn only that the owner role is needed. */
export function scopeErrorResponse(error: ScopeError) {
  const status =
    error === "UNAUTHENTICATED" ? 401 : error === "OWNER_REQUIRED" ? 403 : 404;
  return apiError(error, status);
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
