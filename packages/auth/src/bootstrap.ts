import {
  createSupportRepository,
  getSharedDatabase,
  loadRootEnv,
  requireDatabaseUrl,
} from "@ai-support-platform/db";
import { z } from "zod";
import { getSetupAuth } from "./auth";

export const MIN_OWNER_PASSWORD_LENGTH = 16;

export const bootstrapInputSchema = z.object({
  ownerEmail: z.email().max(320),
  ownerName: z.string().trim().min(1).max(120),
  ownerPassword: z.string().max(256).optional(),
  workspaceName: z.string().trim().min(1).max(120),
  projectName: z.string().trim().min(1).max(120),
  projectSlug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80)
    .optional(),
  allowedOrigins: z.array(z.string()).min(1).max(20),
});
export type BootstrapInput = z.infer<typeof bootstrapInputSchema>;

export interface BootstrapResult {
  createdOwner: boolean;
  createdWorkspace: boolean;
  createdProject: boolean;
  workspaceId: string;
  projectId: string;
  projectName: string;
  publicKey: string;
  allowedOrigins: string[];
}

/** Narrow ports so the flow is testable without Better Auth or PostgreSQL. */
export interface BootstrapPorts {
  findUserByEmail(email: string): Promise<{ id: string } | undefined>;
  createOwner(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<void>;
  markUserEmailVerified(userId: string): Promise<void>;
  bootstrapWorkspaceProject(input: {
    userId: string;
    workspaceName: string;
    project: { name: string; slug: string; allowedOrigins: string[] };
  }): Promise<{
    workspace: { id: string };
    project: {
      id: string;
      name: string;
      publicKey: string;
      allowedOrigins: string[];
    };
    createdWorkspace: boolean;
    createdProject: boolean;
  }>;
}

export class BootstrapError extends Error {
  constructor(
    public readonly code: "PASSWORD_REQUIRED" | "INVALID_INPUT",
    message: string,
  ) {
    super(message);
    this.name = "BootstrapError";
  }
}

/** URL-safe project slug from a display name ("My Site!" → "my-site"). */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "project";
}

/**
 * Provision an installation: the owner (created verified, since an operator
 * or first-run setup creates it deliberately; the password is required only
 * to create it and is never changed), their workspace, and a project. Safe to
 * repeat: existing rows are reused. Never creates demo data.
 */
export async function bootstrapInstallation(
  ports: BootstrapPorts,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const parsed = bootstrapInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new BootstrapError("INVALID_INPUT", "Setup details are invalid.");
  }
  const valid = parsed.data;
  let user = await ports.findUserByEmail(valid.ownerEmail);
  const createdOwner = !user;
  if (!user) {
    if (
      !valid.ownerPassword ||
      valid.ownerPassword.length < MIN_OWNER_PASSWORD_LENGTH
    ) {
      throw new BootstrapError(
        "PASSWORD_REQUIRED",
        `A password of at least ${MIN_OWNER_PASSWORD_LENGTH} characters is required to create the owner.`,
      );
    }
    await ports.createOwner({
      email: valid.ownerEmail,
      password: valid.ownerPassword,
      name: valid.ownerName,
    });
    user = await ports.findUserByEmail(valid.ownerEmail);
    if (!user) throw new Error("Owner not found after creation");
  }
  await ports.markUserEmailVerified(user.id);
  const result = await ports.bootstrapWorkspaceProject({
    userId: user.id,
    workspaceName: valid.workspaceName,
    project: {
      name: valid.projectName,
      slug: valid.projectSlug ?? slugify(valid.projectName),
      allowedOrigins: valid.allowedOrigins,
    },
  });
  return {
    createdOwner,
    createdWorkspace: result.createdWorkspace,
    createdProject: result.createdProject,
    workspaceId: result.workspace.id,
    projectId: result.project.id,
    projectName: result.project.name,
    publicKey: result.project.publicKey,
    allowedOrigins: result.project.allowedOrigins,
  };
}

/** Live ports over DATABASE_URL and the email-less setup auth instance. */
export function createBootstrapPorts(): BootstrapPorts & {
  countUsers(): Promise<number>;
} {
  loadRootEnv();
  const { db } = getSharedDatabase(requireDatabaseUrl("DATABASE_URL"));
  const support = createSupportRepository(db);
  return {
    countUsers: () => support.countUsers(),
    findUserByEmail: (email) => support.findUserByEmail(email),
    createOwner: async ({ email, password, name }) => {
      const created = await getSetupAuth().api.signUpEmail({
        body: { email, password, name },
        headers: new Headers(),
      });
      if (!created?.user) throw new Error("Owner signup did not return a user");
    },
    markUserEmailVerified: (userId) => support.markUserEmailVerified(userId),
    bootstrapWorkspaceProject: (input) =>
      support.bootstrapWorkspaceProject(input),
  };
}
