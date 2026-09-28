import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const E2E_WEBHOOK_SECRET = "local-e2e-webhook-secret";
// Separate ports and Next output let the suite run beside `pnpm dev`
// (3000/3001) without sharing its server, database, or credentials.
export const PLATFORM = "http://127.0.0.1:3100";
export const DEMO = "http://127.0.0.1:3101";
// Local seed credentials for the isolated E2E database only; see .env.example.
export const E2E_OWNER = {
  email: "owner@local.example",
  password: "change-me-local-dev-01",
};

function rootEnv(): Record<string, string | undefined> {
  const path = fileURLToPath(new URL("../.env", import.meta.url));
  const file = existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
  return { ...file, ...process.env };
}

function isLocal(url: URL) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}

/**
 * Browser tests own a separate `_e2e` database beside development data, so
 * E2E tickets never mix with live-validation tickets or their GitHub links.
 * DATABASE_URL_E2E overrides; otherwise the development URL gains `_e2e`.
 */
export function e2eDatabaseUrl(): string {
  const env = rootEnv();
  const development = env.DATABASE_URL;
  const configured = env.DATABASE_URL_E2E ?? development;
  if (!configured) {
    throw new Error("Set DATABASE_URL (or DATABASE_URL_E2E) in .env for E2E");
  }
  const url = new URL(configured);
  if (!env.DATABASE_URL_E2E) url.pathname = `${url.pathname}_e2e`;
  if (
    !isLocal(url) ||
    !url.pathname.endsWith("_e2e") ||
    url.toString() === development
  ) {
    throw new Error("E2E database must be a separate local *_e2e database");
  }
  return url.toString();
}
