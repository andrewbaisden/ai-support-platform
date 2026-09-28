import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Consumers prepared by package-check/prepare.mjs outside the workspace.
const WORK = join(tmpdir(), "issuerelay-package-check");

export default defineConfig({
  testDir: ".",
  testMatch: "consumer.spec.ts",
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: { ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "npm run preview",
      cwd: join(WORK, "vite"),
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run start",
      cwd: join(WORK, "next"),
      url: "http://127.0.0.1:4174",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
