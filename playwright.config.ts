import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    ...devices["Desktop Chrome"],
  },
  // One command builds shared package dist output first, then starts both
  // Next.js apps. Separate parallel dev commands each rebuild dist while the
  // other app bundles it, which intermittently poisoned the demo bundle.
  webServer: [
    {
      command: "pnpm dev:e2e",
      url: "http://127.0.0.1:3001",
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
