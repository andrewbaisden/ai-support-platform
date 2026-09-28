import {
  createSupportRepository,
  getSharedDatabase,
  loadRootEnv,
  requireDatabaseUrl,
} from "@ai-support-platform/db";
import { getAuth } from "./auth";
import { AuthForbiddenError, AuthRequiredError } from "./errors";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface WorkspaceAccess {
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "member";
}

let repository: ReturnType<typeof createSupportRepository> | undefined;

function getRepository() {
  if (!repository) {
    loadRootEnv();
    const { db } = getSharedDatabase(requireDatabaseUrl("DATABASE_URL"));
    repository = createSupportRepository(db);
  }
  return repository;
}

/** Resolve the session user from request headers or throw AuthRequiredError. */
export async function requireSessionUser(
  headers: Headers,
): Promise<SessionUser> {
  const session = await getAuth().api.getSession({ headers });
  if (!session?.user) throw new AuthRequiredError();
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}

/** Workspaces the user may access, or throw AuthForbiddenError when none. */
export async function requireWorkspaces(
  userId: string,
): Promise<WorkspaceAccess[]> {
  const rows = await getRepository().listWorkspacesForUser(userId);
  if (rows.length === 0) throw new AuthForbiddenError();
  return rows.map((row) => ({
    workspaceId: row.workspace.id,
    workspaceName: row.workspace.name,
    role: row.role,
  }));
}

/** Assert membership in one workspace or throw AuthForbiddenError. */
export async function requireWorkspaceAccess(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const rows = await getRepository().listWorkspacesForUser(userId);
  const match = rows.find((row) => row.workspace.id === workspaceId);
  if (!match) throw new AuthForbiddenError();
  return {
    workspaceId: match.workspace.id,
    workspaceName: match.workspace.name,
    role: match.role,
  };
}

/** Find a user by email for controlled bootstrap flows. */
export async function findUserByEmail(email: string) {
  return getRepository().findUserByEmail(email);
}

/** Grant workspace membership for controlled bootstrap flows. */
export async function grantWorkspaceMembership(input: {
  workspaceId: string;
  userId: string;
  role: "owner" | "member";
}) {
  return getRepository().createWorkspaceMember(input);
}
