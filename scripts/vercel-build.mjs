// Vercel build for apps/web (see apps/web/vercel.json). Production builds
// apply the checked-in, reviewed migrations first over the direct
// (unpooled) connection; preview builds never migrate. Migrations are
// additive and idempotent, so a failed build leaves a compatible schema.
import { execFileSync } from "node:child_process";

function run(command, args, env = {}) {
  execFileSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

if (process.env.VERCEL_ENV === "production") {
  const direct = process.env.DATABASE_URL_UNPOOLED;
  if (!direct) {
    console.error("DATABASE_URL_UNPOOLED is required to migrate production.");
    process.exit(1);
  }
  run("pnpm", ["db:migrate"], { DATABASE_URL: direct });
}
run("pnpm", ["--filter", "@ai-support-platform/support-contracts", "build"]);
run("pnpm", ["--filter", "@ai-support-platform/web", "build"]);
