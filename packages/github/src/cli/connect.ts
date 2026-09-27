import {
  createDatabase,
  createSupportRepository,
  loadRootEnv,
  requireDatabaseUrl,
} from "@ai-support-platform/db";

function usage(): never {
  process.stdout.write(
    `Usage: pnpm github:connect --project <uuid> --installation <id> --repository <id> --owner <owner> --repo <name>

Records the project's GitHub App installation/repository link.
Values come from the GitHub App installation on the disposable repository.
`,
  );
  process.exit(2);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

loadRootEnv();
const projectId = argValue("--project");
const owner = argValue("--owner");
const repo = argValue("--repo");
const installation = Number(argValue("--installation"));
const repository = Number(argValue("--repository"));
if (
  !projectId ||
  !owner ||
  !repo ||
  !Number.isInteger(installation) ||
  installation <= 0 ||
  !Number.isInteger(repository) ||
  repository <= 0
) {
  usage();
}

const { db, pool } = createDatabase(requireDatabaseUrl("DATABASE_URL"));
const support = createSupportRepository(db);
try {
  const context = await support.getProjectWorkspace(projectId);
  if (!context) {
    process.stderr.write(`Project not found: ${projectId}\n`);
    process.exit(1);
  }
  await support.connectGitHubRepository({
    workspaceId: context.workspaceId,
    projectId,
    installationId: BigInt(installation),
    repositoryId: BigInt(repository),
    repositoryOwner: owner,
    repositoryName: repo,
  });
  process.stdout.write(
    `connected ${owner}/${repo} (installation ${installation})\n`,
  );
} finally {
  await pool.end();
}
