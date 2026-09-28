import { defineConfig, devices } from "@playwright/test";
import {
  DEMO,
  E2E_SETUP_TOKEN,
  E2E_WEBHOOK_SECRET,
  e2eDatabaseUrl,
  e2eSetupDatabaseUrl,
  PLATFORM,
  SETUP_PLATFORM,
} from "./e2e/e2e-env";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Local Better Auth sign-in and Next dev compilation are flaky under
  // concurrent browser workers; serialize the shared dev-server journey.
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: PLATFORM,
    ...devices["Desktop Chrome"],
  },
  // One command builds shared package dist output first, then starts both
  // Next.js apps. Separate parallel dev commands each rebuild dist while the
  // other app bundles it, which intermittently poisoned the demo bundle.
  //
  // The browser suite always starts its own servers on 3100/3101 with a
  // separate Next output directory and the isolated `_e2e` database, so it
  // runs beside `pnpm dev`. Reusing a running dev server once pointed tests
  // at a live-configured app and the development database, where E2E
  // tickets could later be escalated to a real repository.
  // GITHUB_ESCALATION_MOCK fakes only the GitHub network (authz enforced);
  // blank App and Jev credentials make any unmocked path fail closed.
  webServer: [
    {
      command: "pnpm dev:e2e",
      url: DEMO,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        WEB_PORT: new URL(PLATFORM).port,
        DEMO_PORT: new URL(DEMO).port,
        NEXT_DIST_DIR: ".next-e2e",
        BETTER_AUTH_URL: PLATFORM,
        NEXT_PUBLIC_SUPPORT_API_URL: PLATFORM,
        DATABASE_URL: e2eDatabaseUrl(),
        GITHUB_ESCALATION_MOCK: "1",
        GITHUB_WEBHOOK_SECRET: E2E_WEBHOOK_SECRET,
        GITHUB_APP_ID: "",
        GITHUB_APP_PRIVATE_KEY: "",
        TYPESAFE_API_KEY: "",
      },
    },
    // Starts after the first server has built the shared packages. An empty
    // database plus SETUP_TOKEN exercises first-run setup and settings.
    {
      command: "pnpm --filter @ai-support-platform/web dev",
      url: `${SETUP_PLATFORM}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        WEB_PORT: new URL(SETUP_PLATFORM).port,
        NEXT_DIST_DIR: ".next-e2e-setup",
        BETTER_AUTH_URL: SETUP_PLATFORM,
        DATABASE_URL: e2eSetupDatabaseUrl(),
        SETUP_TOKEN: E2E_SETUP_TOKEN,
        GITHUB_ESCALATION_MOCK: "1",
        GITHUB_WEBHOOK_SECRET: E2E_WEBHOOK_SECRET,
        GITHUB_APP_ID: "",
        GITHUB_APP_PRIVATE_KEY: "",
        TYPESAFE_API_KEY: "",
      },
    },
  ],
});
