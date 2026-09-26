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
  loadDotEnv({ path: new URL("../../../.env", import.meta.url) });
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
