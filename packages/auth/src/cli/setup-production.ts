import {
  getSharedDatabase,
  loadRootEnv,
  requireDatabaseUrl,
} from "@ai-support-platform/db";
import {
  BootstrapError,
  bootstrapInstallation,
  createBootstrapPorts,
} from "../bootstrap";

/**
 * Production bootstrap without demo data: one owner (verified, because an
 * operator creates it deliberately), one workspace, and one project for the
 * sites that will embed the widget. Safe to re-run: existing rows are reused.
 */
function usage(): never {
  process.stdout.write(
    `Usage: OWNER_EMAIL=<email> [OWNER_PASSWORD=<16+ chars, new owner only>] \\
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

// Owner credentials come only from this command's environment, never from
// a .env file: a production password must not be picked up implicitly.
const ownerEmail = process.env.OWNER_EMAIL?.trim();
const ownerPassword = process.env.OWNER_PASSWORD;
loadRootEnv();
// Account emails are not needed here; never send one during setup.
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;

const workspaceName = argValue("--workspace");
const projectName = argValue("--project");
const slug = argValue("--slug");
const origins = argValues("--origin");
if (!workspaceName || !projectName || !slug || origins.length === 0) usage();
if (!ownerEmail) {
  process.stderr.write("OWNER_EMAIL is required.\n");
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

const ports = createBootstrapPorts();
try {
  const result = await bootstrapInstallation(ports, {
    ownerEmail,
    ownerName: argValue("--owner-name") ?? "Workspace Owner",
    ...(ownerPassword ? { ownerPassword } : {}),
    workspaceName,
    projectName,
    projectSlug: slug,
    allowedOrigins: origins,
  });
  process.stdout.write(
    result.createdOwner
      ? `Created owner ${ownerEmail}\n`
      : `Owner exists: ${ownerEmail} (password unchanged)\n`,
  );
  process.stdout.write(
    `${result.createdWorkspace ? "Created workspace" : "Workspace exists:"} ${workspaceName}\n`,
  );
  process.stdout.write(
    result.createdProject
      ? `Created project ${result.projectName}\n`
      : `Project exists: ${result.projectName} (origins: ${result.allowedOrigins.join(", ")})\n`,
  );
  process.stdout.write(
    `\nWorkspace ID: ${result.workspaceId}\nProject ID:   ${result.projectId}\nWidget key:   ${result.publicKey}  (public; use as projectKey)\n`,
  );
} catch (error) {
  if (error instanceof BootstrapError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  } else {
    throw error;
  }
} finally {
  await getSharedDatabase(target.toString()).pool.end();
}
