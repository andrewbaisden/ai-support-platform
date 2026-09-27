import {
  requireSessionUser,
  requireWorkspaceAccess,
  requireWorkspaces,
  type SessionUser,
  type WorkspaceAccess,
} from "@ai-support-platform/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/** True only for same-origin relative paths; prevents open redirects. */
export function safeCallbackUrl(value: string | null): string {
  if (value?.startsWith("/") === true && !value.startsWith("//")) {
    return value;
  }
  return "/dashboard";
}

export async function requireDashboardUser(
  callbackUrl = "/dashboard",
): Promise<{ user: SessionUser; workspaces: WorkspaceAccess[] }> {
  let user: SessionUser;
  try {
    user = await requireSessionUser(await headers());
  } catch {
    redirect(
      `/login?callbackUrl=${encodeURIComponent(safeCallbackUrl(callbackUrl))}`,
    );
  }
  const workspaces = await requireWorkspaces(user.id).catch(
    (): WorkspaceAccess[] => [],
  );
  return { user, workspaces };
}

/** Membership in a known workspace; unknown or foreign workspaces bounce. */
export async function requireProjectAccess(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  try {
    return await requireWorkspaceAccess(userId, workspaceId);
  } catch {
    redirect("/dashboard");
  }
}
