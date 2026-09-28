import {
  createDatabase,
  createSupportRepository,
  generatePublicProjectKey,
  loadRootEnv,
  requireDatabaseUrl,
} from "@ai-support-platform/db";
import { getAuth } from "../auth";

/**
 * Production bootstrap without demo data: one owner (verified, because an
 * operator creates it deliberately), one workspace, and one project for the
 * sites that will embed the widget. Safe to re-run: existing rows are reused.
 */
function usage(): never {
  process.stdout.write(
    `Usage: OWNER_EMAIL=<email> OWNER_PASSWORD=<16+ chars> \\
  pnpm setup:production --workspace "<name>" --project "<name>" --slug <slug> \\
  --origin https://example.com [--origin https://www.example.com] [--owner-name "<name>"] --yes

Targets DATABASE_URL (use the direct, unpooled URL for production).
Never runs the demo seed. Prints the project's public widget key.
`,
  );
  process.exit(2);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function argValues(name: string): string[] {
  return process.argv.flatMap((value, index) =>
    value === name && process.argv[index + 1]
      ? [process.argv[index + 1] ?? ""]
      : [],
  );
}

loadRootEnv();
// Account emails are not needed here; never send one during setup.
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;

const workspaceName = argValue("--workspace");
const projectName = argValue("--project");
const slug = argValue("--slug");
const origins = argValues("--origin");
const ownerEmail = process.env.OWNER_EMAIL?.trim();
const ownerPassword = process.env.OWNER_PASSWORD;
if (!workspaceName || !projectName || !slug || origins.length === 0) usage();
if (!ownerEmail || !ownerPassword) {
  process.stderr.write("OWNER_EMAIL and OWNER_PASSWORD are required.\n");
  process.exit(2);
}
if (ownerPassword.length < 16) {
  process.stderr.write("OWNER_PASSWORD must be at least 16 characters.\n");
  process.exit(2);
}
for (const origin of origins) {
  const url = new URL(origin);
  if (url.origin !== origin) {
    process.stderr.write(`--origin must be a bare origin, got ${origin}\n`);
    process.exit(2);
  }
}
const target = new URL(requireDatabaseUrl("DATABASE_URL"));
process.stdout.write(`Target database: ${target.hostname}${target.pathname}\n`);
if (!process.argv.includes("--yes")) {
  process.stderr.write("Re-run with --yes to write to this database.\n");
  process.exit(2);
}

const { db, pool } = createDatabase(target.toString());
const support = createSupportRepository(db);
try {
  let user = await support.findUserByEmail(ownerEmail);
  if (!user) {
    const created = await getAuth().api.signUpEmail({
      body: {
        email: ownerEmail,
        password: ownerPassword,
        name: argValue("--owner-name") ?? "Workspace Owner",
      },
      headers: new Headers(),
    });
    if (!created?.user) throw new Error("Owner signup did not return a user");
    user = await support.findUserByEmail(ownerEmail);
    process.stdout.write(`Created owner ${ownerEmail}\n`);
  } else {
    process.stdout.write(`Owner exists: ${ownerEmail} (password unchanged)\n`);
  }
  if (!user) throw new Error("Owner not found after creation");
  await support.markUserEmailVerified(user.id);

  const memberships = await support.listWorkspacesForUser(user.id);
  let workspace = memberships.find(
    (row) => row.role === "owner" && row.workspace.name === workspaceName,
  )?.workspace;
  if (!workspace) {
    workspace = await support.createWorkspace(workspaceName);
    await support.createWorkspaceMember({
      workspaceId: workspace.id,
      userId: user.id,
      role: "owner",
    });
    process.stdout.write(`Created workspace ${workspaceName}\n`);
  } else {
    process.stdout.write(`Workspace exists: ${workspaceName}\n`);
  }

  const projects = await support.listProjectsForWorkspace(workspace.id);
  let project = projects.find((row) => row.slug === slug);
  if (!project) {
    project = await support.createProject({
      workspaceId: workspace.id,
      name: projectName,
      slug,
      publicKey: generatePublicProjectKey(),
      allowedOrigins: origins,
    });
    process.stdout.write(`Created project ${projectName}\n`);
  } else {
    process.stdout.write(
      `Project exists: ${project.name} (origins: ${project.allowedOrigins.join(", ")})\n`,
    );
  }
  process.stdout.write(
    `\nWorkspace ID: ${workspace.id}\nProject ID:   ${project.id}\nWidget key:   ${project.publicKey}  (public; use as projectKey)\n`,
  );
} finally {
  await pool.end();
}
