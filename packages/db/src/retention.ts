import { createDatabase } from "./client";
import { loadRootEnv, requireDatabaseUrl } from "./env";
import { createSupportRepository } from "./repository";
import { RETENTION_DEFAULTS } from "./retention-policy";

/**
 * Data retention. Dry run by default; `--apply` erases.
 *
 * - Visitor name/email are erased from tickets resolved more than
 *   `--contact-days` ago (default 180). Reports and audit history stay.
 * - Processed/ignored webhook delivery records older than `--webhook-days`
 *   (default 90, minimum 7) are deleted. GitHub can redeliver deliveries
 *   from the past 3 days; deleting a newer record would let a redelivery
 *   process twice.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function usage(): never {
  process.stdout.write(
    `Usage: pnpm db:retention [--apply] [--contact-days 180] [--webhook-days 90]

Without --apply, reports what would be erased or deleted and changes nothing.
`,
  );
  process.exit(2);
}

function days(flag: string, fallback: number, minimum: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < minimum) {
    process.stderr.write(`${flag} must be an integer of at least ${minimum}\n`);
    process.exit(2);
  }
  return value;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) usage();
const apply = process.argv.includes("--apply");
const contactDays = days("--contact-days", RETENTION_DEFAULTS.contactDays, 1);
const webhookDays = days(
  "--webhook-days",
  RETENTION_DEFAULTS.webhookDays,
  RETENTION_DEFAULTS.minimumWebhookDays,
);

loadRootEnv();
const { db, pool } = createDatabase(requireDatabaseUrl("DATABASE_URL"));
const support = createSupportRepository(db);
const now = Date.now();
try {
  const contacts = await support.eraseResolvedContactDetails({
    resolvedBefore: new Date(now - contactDays * DAY_MS),
    dryRun: !apply,
  });
  const deliveries = await support.deleteWebhookDeliveries({
    receivedBefore: new Date(now - webhookDays * DAY_MS),
    dryRun: !apply,
  });
  const verb = apply ? "" : " (dry run; pass --apply to change data)";
  process.stdout.write(
    `Contact details ${apply ? "erased" : "to erase"} for ${contacts.tickets} ticket(s) resolved over ${contactDays} days ago${verb}.\n` +
      `Webhook delivery records ${apply ? "deleted" : "to delete"}: ${deliveries.deliveries} older than ${webhookDays} days${verb}.\n`,
  );
} finally {
  await pool.end();
}
