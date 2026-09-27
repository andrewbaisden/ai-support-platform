import {
  createDatabase,
  createSupportRepository,
  loadRootEnv,
  requireDatabaseUrl,
} from "@ai-support-platform/db";
import {
  FixtureTicketClassifier,
  JevTicketClassifier,
  type TicketClassifier,
  type TriageRepository,
  triageTicket,
} from "../index";

function usage(): never {
  process.stdout.write(
    `Usage:
  pnpm ai:triage --pending [--limit 10] [--classifier mock|jev]
  pnpm ai:triage --ticket <uuid> [--classifier mock|jev]

mock (default) needs no credentials. jev requires TYPESAFE_API_KEY and
honors TYPESAFE_DEFAULT_MODEL. Failures keep tickets in needs_triage.
`,
  );
  process.exit(2);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function createClassifier(kind: string): TicketClassifier {
  if (kind === "mock") return new FixtureTicketClassifier();
  if (kind === "jev") {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) {
      process.stderr.write(
        "TYPESAFE_API_KEY is required for --classifier jev\n",
      );
      process.exit(2);
    }
    const model = process.env.TYPESAFE_DEFAULT_MODEL;
    return new JevTicketClassifier({
      apiKey,
      ...(model ? { model } : {}),
    });
  }
  return usage();
}

loadRootEnv();
const { db, pool } = createDatabase(requireDatabaseUrl("DATABASE_URL"));
const repository = createSupportRepository(db);
const port: TriageRepository = {
  getCurrentClassification: (input) =>
    repository.getCurrentClassificationForProject(
      input.workspaceId,
      input.projectId,
      input.ticketId,
    ),
  appendClassification: (input) =>
    repository.appendClassification(input.workspaceId, {
      projectId: input.projectId,
      ticketId: input.ticketId,
      type: input.type,
      severity: input.severity,
      route: input.route,
      githubIssueRecommended: input.githubIssueRecommended,
      confidence: input.confidence,
      source: input.source,
      provider: input.provider,
      model: input.model,
      reason: input.reason,
    }),
  recordTicketEvent: (input) =>
    repository.recordTicketEvent(input).then(() => {}),
};

try {
  if (hasFlag("--help") || hasFlag("-h")) usage();
  const classifier = createClassifier(argValue("--classifier") ?? "mock");
  const ticketArg = argValue("--ticket");

  const targets: Array<{
    ticketId: string;
    projectId: string;
    workspaceId: string;
    status: string;
  }> = [];
  if (ticketArg) {
    const context = await repository.findTicketContext(ticketArg);
    if (!context) {
      process.stderr.write(`Ticket not found: ${ticketArg}\n`);
      process.exit(1);
    }
    targets.push(context);
  } else if (hasFlag("--pending")) {
    const limit = Number(argValue("--limit") ?? "10");
    targets.push(...(await repository.listTicketsNeedingTriage(limit)));
  } else {
    usage();
  }

  if (targets.length === 0) {
    process.stdout.write("No tickets to triage.\n");
  }
  let classified = 0;
  let failed = 0;
  for (const target of targets) {
    const submission = await repository.getTicketSubmissionText(
      target.projectId,
      target.ticketId,
    );
    if (!submission) {
      process.stdout.write(`skip ${target.ticketId}: no visitor message\n`);
      continue;
    }
    const outcome = await triageTicket(port, classifier, {
      ticketId: target.ticketId,
      projectId: target.projectId,
      workspaceId: target.workspaceId,
      status: target.status,
      message: submission.message,
      ...(submission.categoryHint
        ? { categoryHint: submission.categoryHint }
        : {}),
    });
    if (outcome.outcome === "classified") {
      classified += 1;
      process.stdout.write(
        `classified ${target.ticketId}: type=${outcome.type} route=${outcome.route} ` +
          `confidence=${outcome.confidence} github_eligible=${outcome.githubEligible}\n`,
      );
    } else if (outcome.outcome === "already-triaged") {
      process.stdout.write(`skip ${target.ticketId}: already triaged\n`);
    } else {
      failed += 1;
      process.stdout.write(
        `failed ${target.ticketId}: ${outcome.code} (kept for retry)\n`,
      );
    }
  }
  process.stdout.write(
    `done: ${classified} classified, ${failed} failed, ${targets.length - classified - failed} skipped\n`,
  );
} finally {
  await pool.end();
}
