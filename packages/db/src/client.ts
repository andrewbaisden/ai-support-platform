import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { withExplicitSslMode } from "./ssl-mode";

const DEFAULT_POOL_MAX = 5;
const LIMIT_POOL_MAX = 50;

/**
 * Per-pool connection cap from DATABASE_POOL_MAX (default 5). Size it so
 * instances × pool size stays under the database's connection limit.
 */
export function poolSizeFromEnv(): number {
  const raw = process.env.DATABASE_POOL_MAX?.trim();
  if (!raw) return DEFAULT_POOL_MAX;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > LIMIT_POOL_MAX) {
    throw new Error(
      `DATABASE_POOL_MAX must be an integer from 1 to ${LIMIT_POOL_MAX}`,
    );
  }
  return value;
}

/** A new pool owned by the caller (CLIs end it when they finish). */
export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString: withExplicitSslMode(connectionString),
    max: poolSizeFromEnv(),
  });
  const db = drizzle({ client: pool, schema });
  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];

// Kept on globalThis so bundled copies of this module and dev hot reloads
// reuse the same pools instead of multiplying connections.
const registry = globalThis as typeof globalThis & {
  __aiSupportDatabases?: Map<string, ReturnType<typeof createDatabase>>;
};

/**
 * The process-wide pool for long-running servers. The platform's request
 * repository, Better Auth, and session helpers share it rather than each
 * opening their own pool against the same database.
 */
export function getSharedDatabase(connectionString: string) {
  registry.__aiSupportDatabases ??= new Map();
  let entry = registry.__aiSupportDatabases.get(connectionString);
  if (!entry) {
    entry = createDatabase(connectionString);
    registry.__aiSupportDatabases.set(connectionString, entry);
  }
  return entry;
}
