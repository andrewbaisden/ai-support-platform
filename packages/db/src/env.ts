import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

const databaseUrlSchema = z
  .url()
  .refine(
    (value) =>
      value.startsWith("postgresql://") || value.startsWith("postgres://"),
    {
      message: "Expected a PostgreSQL connection URL",
    },
  );

export function loadRootEnv() {
  // import.meta.url is unreliable once a bundler (Next.js webpack) transpiles
  // this module, so fall back to working-directory candidates. dotenv never
  // overrides variables that are already set, so loading every candidate that
  // exists is safe. Deployed environments must provide DATABASE_URL directly.
  const candidates: string[] = [];
  try {
    candidates.push(fileURLToPath(new URL("../../../.env", import.meta.url)));
  } catch {
    // Bundler rewrote import.meta.url; rely on the candidates below.
  }
  candidates.push(join(process.cwd(), ".env"));
  candidates.push(join(process.cwd(), "..", "..", ".env"));
  for (const path of candidates) {
    // quiet: dotenv v18 reports via console.error, which Next.js dev
    // surfaces as a blocking error overlay in the browser.
    if (existsSync(path)) loadDotEnv({ path, quiet: true });
  }
}

export function requireDatabaseUrl(name: "DATABASE_URL" | "DATABASE_URL_TEST") {
  const value = process.env[name];
  return databaseUrlSchema.parse(value);
}

export function requireSafeTestDatabaseUrl() {
  const url = new URL(requireDatabaseUrl("DATABASE_URL_TEST"));
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("DATABASE_URL_TEST must point to local PostgreSQL");
  }
  if (!url.pathname.endsWith("_test")) {
    throw new Error("DATABASE_URL_TEST must name a database ending in _test");
  }
  if (url.toString() === process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL_TEST must differ from DATABASE_URL");
  }
  return url.toString();
}
