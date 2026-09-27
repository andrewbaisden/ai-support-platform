import {
  FixtureTicketClassifier,
  JevTicketClassifier,
  runEvaluation,
  type TicketClassifier,
} from "../index";

function usage(): never {
  process.stdout.write(
    `Usage: pnpm ai:evaluate [--classifier mock|jev]

mock (default) must pass every fixture and exits nonzero otherwise.
jev requires TYPESAFE_API_KEY, honors TYPESAFE_DEFAULT_MODEL, and only
reports observations; live runs never gate CI.
`,
  );
  process.exit(2);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv.includes("--help") || process.argv.includes("-h")) usage();
const kind = argValue("--classifier") ?? "mock";
let classifier: TicketClassifier;
if (kind === "mock") {
  classifier = new FixtureTicketClassifier();
} else if (kind === "jev") {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    process.stderr.write("TYPESAFE_API_KEY is required for --classifier jev\n");
    process.exit(2);
  }
  const model = process.env.TYPESAFE_DEFAULT_MODEL;
  classifier = new JevTicketClassifier({
    apiKey,
    ...(model ? { model } : {}),
  });
} else {
  usage();
}

const summary = await runEvaluation(classifier);
for (const result of summary.results) {
  const detail = result.passed
    ? `type=${result.actual?.type} route=${result.route} confidence=${result.actual?.confidence} eligible=${result.eligible}`
    : `MISMATCH ${result.mismatches.join("; ")}`;
  process.stdout.write(
    `${result.passed ? "pass" : "FAIL"} ${result.name}: ${detail}\n`,
  );
}
process.stdout.write(
  `fixtures ${summary.fixtureVersion}: ${summary.passed}/${summary.total} passed\n`,
);
if (kind === "mock" && summary.passed !== summary.total) process.exit(1);
