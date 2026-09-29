import { config as loadDotEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";
import { withExplicitSslMode } from "./src/ssl-mode";

loadDotEnv({ path: new URL("../../.env", import.meta.url) });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: process.env.DATABASE_URL
    ? { url: withExplicitSslMode(process.env.DATABASE_URL) }
    : undefined,
});
