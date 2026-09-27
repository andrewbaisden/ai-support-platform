import { loadRootEnv } from "@ai-support-platform/db";
import { getAuth } from "../auth";
import { findUserByEmail, grantWorkspaceMembership } from "../session";

function usage(): never {
  process.stdout.write(
    `Usage: SEED_OWNER_EMAIL=owner@local.example SEED_OWNER_PASSWORD=<12+ chars> pnpm auth:bootstrap --workspace <uuid> [--name Owner]

Creates the owner account (or reuses it) and grants workspace ownership.
Run after pnpm db:seed. Development bootstrap only.
`,
  );
  process.exit(2);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

loadRootEnv();
const workspaceId = argValue("--workspace");
const email = process.env.SEED_OWNER_EMAIL;
const password = process.env.SEED_OWNER_PASSWORD;
if (!workspaceId) usage();
if (!email || !password) {
  process.stdout.write(
    "SEED_OWNER_EMAIL/PASSWORD unset; skipping owner bootstrap.\n",
  );
  process.exit(0);
}

const existing = await findUserByEmail(email);
let userId = existing?.id;
if (!userId) {
  const created = await getAuth().api.signUpEmail({
    body: {
      email,
      password,
      name: argValue("--name") ?? "Workspace Owner",
    },
    headers: new Headers(),
  });
  if (!created?.user) throw new Error("Owner signup did not return a user");
  userId = created.user.id;
  process.stdout.write(`created owner account ${email}\n`);
} else {
  process.stdout.write(`owner account exists ${email}\n`);
}
await grantWorkspaceMembership({
  workspaceId,
  userId,
  role: "owner",
}).catch((error: unknown) => {
  if (error instanceof Error && /already exists/.test(error.message)) {
    process.stdout.write("ownership already granted\n");
    return;
  }
  throw error;
});
process.stdout.write(`owner can access workspace ${workspaceId}\n`);
