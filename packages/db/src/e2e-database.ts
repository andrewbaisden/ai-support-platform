import { Pool } from "pg";
import { loadRootEnv, requireDatabaseUrl } from "./env";

/**
 * Browser-test database tooling. `create` makes the database named by
 * DATABASE_URL when missing; `recreate` drops and recreates it empty (the
 * first-run setup suite needs a database with no accounts); `allow-origin <origin>` lets the seeded
 * projects accept the E2E demo origin. Refusing anything but a local `_e2e`
 * database keeps this from touching development or hosted data.
 */
loadRootEnv();
const target = new URL(requireDatabaseUrl("DATABASE_URL"));
const name = decodeURIComponent(target.pathname.slice(1));
if (
  (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") ||
  !/^[a-z0-9_]+_e2e$/.test(name)
) {
  throw new Error("E2E database must be local and end in _e2e");
}
const [command, argument] = process.argv.slice(2);

if (command === "create" || command === "recreate") {
  const admin = new URL(target);
  admin.pathname = "/postgres";
  const pool = new Pool({ connectionString: admin.toString(), max: 1 });
  try {
    if (command === "recreate") {
      // Identifier validated above; DROP DATABASE cannot take a parameter.
      await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    const existing = await pool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [name],
    );
    if (existing.rowCount === 0) {
      // Identifier validated above; CREATE DATABASE cannot take a parameter.
      await pool.query(`CREATE DATABASE "${name}"`);
      process.stdout.write(`Created ${name}.\n`);
    }
  } finally {
    await pool.end();
  }
} else if (command === "allow-origin" && argument) {
  const origin = new URL(argument).origin;
  const pool = new Pool({ connectionString: target.toString(), max: 1 });
  try {
    await pool.query(
      `UPDATE projects SET allowed_origins = array_append(allowed_origins, $1)
       WHERE NOT ($1 = ANY(allowed_origins))`,
      [origin],
    );
  } finally {
    await pool.end();
  }
} else {
  throw new Error(
    "Usage: e2e-database.ts create | recreate | allow-origin <origin>",
  );
}
