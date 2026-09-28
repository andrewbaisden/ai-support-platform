import { execFileSync } from "node:child_process";
import { DEMO, E2E_OWNER, e2eDatabaseUrl, REPO_ROOT } from "./e2e-env";

/**
 * Prepare the isolated E2E database: create it if missing, apply checked-in
 * migrations, seed the demo project, mock GitHub target, and owner, then
 * allow the E2E demo origin. Every step is idempotent across runs.
 */
export default function globalSetup() {
  const env = {
    ...process.env,
    DATABASE_URL: e2eDatabaseUrl(),
    SEED_OWNER_EMAIL: E2E_OWNER.email,
    SEED_OWNER_PASSWORD: E2E_OWNER.password,
  };
  for (const args of [
    ["--filter", "@ai-support-platform/db", "db:e2e", "create"],
    ["db:migrate"],
    ["db:seed"],
    ["--filter", "@ai-support-platform/db", "db:e2e", "allow-origin", DEMO],
  ]) {
    execFileSync("pnpm", args, { cwd: REPO_ROOT, env, stdio: "inherit" });
  }
}
