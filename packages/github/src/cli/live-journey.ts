import { randomUUID } from "node:crypto";
import {
  FixtureTicketClassifier,
  JevTicketClassifier,
  type TicketClassifier,
  triageTicket,
} from "@ai-support-platform/ai";
import {
  createDatabase,
  createSupportRepository,
  loadRootEnv,
  requireDatabaseUrl,
  ticketReference,
} from "@ai-support-platform/db";
import { App } from "@octokit/app";
import { createTrackerFactory } from "../app-auth";
import { ISSUE_LABEL_ALLOWLIST } from "../draft";
import {
  type EscalationRepository,
  type EscalationTicket,
  escalateTicketToGitHub,
} from "../escalation-service";
import { webhookTransactionFromScope } from "../link-scope";
import { previewEscalation } from "../preview";

/**
 * Opt-in live acceptance run of steps 5–15 against a real GitHub App and a
 * disposable repository. Creates one real issue, closes and reopens it
 * through the GitHub API, and waits for signed webhooks to reach the running
 * platform. By default it finishes by closing the issue again so the
 * disposable repository does not collect open test issues. Never deletes
 * GitHub data. Never runs in CI.
 */
function usage(): never {
  process.stdout.write(
    `Usage: LIVE_GITHUB_TEST=1 pnpm github:live-journey --repository <owner/name>
    [--project <uuid>] [--platform http://127.0.0.1:3000]
    [--classifier mock|jev] [--webhook-timeout 90] [--finish closed|open]
    [--operator-email <owner email>]

Creates a REAL issue in the project's connected repository. Requires:
- LIVE_GITHUB_TEST=1
- --repository equal to the connected repository, whose name contains
  "disposable", "live-test", or "sandbox"
- GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY, a local DATABASE_URL
- with the mock classifier, an operator account (--operator-email or
  SEED_OWNER_EMAIL) to record the owner recommendation fixture triage needs
- the platform running at --platform with GITHUB_WEBHOOK_SECRET, reachable
  by GitHub through the App's webhook URL (e.g. an HTTPS tunnel)
`,
  );
  process.exit(2);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  process.stderr.write(`ABORT: ${message}\n`);
  process.exit(2);
}

const DISPOSABLE_NAME = /(disposable|live-test|sandbox)/i;
const DEFAULT_PROJECT = "20000000-0000-4000-8000-000000000001";

loadRootEnv();
if (process.argv.includes("--help") || process.argv.includes("-h")) usage();
if (process.env.LIVE_GITHUB_TEST !== "1") {
  fail("LIVE_GITHUB_TEST=1 is required; this run creates a real GitHub issue.");
}
if (process.env.NODE_ENV === "production") {
  fail("Refusing to run with NODE_ENV=production.");
}
const repositoryArg = argValue("--repository") ?? usage();
const [expectedOwner, expectedName, ...extra] = repositoryArg.split("/");
if (!expectedOwner || !expectedName || extra.length > 0) usage();
if (!DISPOSABLE_NAME.test(expectedName)) {
  fail(
    `Repository name "${expectedName}" is not marked disposable (needs disposable, live-test, or sandbox).`,
  );
}
const appId = process.env.GITHUB_APP_ID;
const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (!appId || !privateKey) {
  fail("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required.");
}
const databaseUrl = new URL(requireDatabaseUrl("DATABASE_URL"));
if (!["127.0.0.1", "localhost"].includes(databaseUrl.hostname)) {
  fail("DATABASE_URL must be local for the live journey.");
}
const projectId = argValue("--project") ?? DEFAULT_PROJECT;
const platform = new URL(argValue("--platform") ?? "http://127.0.0.1:3000");
const webhookTimeoutMs = Number(argValue("--webhook-timeout") ?? "90") * 1000;
const classifierKind = argValue("--classifier") ?? "mock";
const finish = argValue("--finish") ?? "closed";
const operatorEmail =
  argValue("--operator-email") ?? process.env.SEED_OWNER_EMAIL;
if (finish !== "closed" && finish !== "open") usage();

function createClassifier(): TicketClassifier {
  if (classifierKind === "mock") return new FixtureTicketClassifier();
  if (classifierKind === "jev") {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) fail("TYPESAFE_API_KEY is required for --classifier jev.");
    const model = process.env.TYPESAFE_DEFAULT_MODEL;
    return new JevTicketClassifier({ apiKey, ...(model ? { model } : {}) });
  }
  return usage();
}

const results: Array<{ step: string; ok: boolean; detail: string }> = [];
function check(step: string, ok: boolean, detail: string) {
  results.push({ step, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${step}: ${detail}\n`);
  return ok;
}

/** Poll observable state instead of sleeping for a fixed time. */
async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs: number,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return undefined;
}

const { db, pool } = createDatabase(databaseUrl.toString());
const support = createSupportRepository(db);

const port: EscalationRepository = {
  getIntegration: async (workspaceId, project) => {
    const row = await support.getIntegrationForProject(workspaceId, project);
    return row
      ? {
          installationId: row.installationId.toString(),
          repositoryId: row.repositoryId.toString(),
          repositoryOwner: row.repositoryOwner,
          repositoryName: row.repositoryName,
          status: row.status,
        }
      : undefined;
  },
  getIssueLink: async (workspaceId, project, ticketId) => {
    const row = await support.getGitHubIssueForTicket(
      workspaceId,
      project,
      ticketId,
    );
    return row
      ? { status: row.status, issueNumber: row.issueNumber, url: row.url }
      : undefined;
  },
  reserveIssueLink: async (input) => {
    if (
      await support.getGitHubIssueForTicket(
        input.workspaceId,
        input.projectId,
        input.ticketId,
      )
    ) {
      return;
    }
    const row = await support.getIntegrationForProject(
      input.workspaceId,
      input.projectId,
    );
    if (!row) throw new Error("Integration missing for reservation");
    await support.reserveGitHubIssue({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      ticketId: input.ticketId,
      integrationId: row.id,
      repositoryId: row.repositoryId,
      reconciliationMarker: input.reconciliationMarker,
    });
  },
  claimIssueCreation: (input) => support.claimGitHubIssueCreation(input),
  confirmIssueLink: async (input) => {
    await support.confirmGitHubIssue(input);
  },
  markIssueStatus: async (input) => {
    await support.markGitHubIssueStatus(input);
  },
  recordEvent: async (input) => {
    await support.recordTicketEvent({
      projectId: input.projectId,
      ticketId: input.ticketId,
      type: input.type,
      ...(input.summary ? { summary: input.summary } : {}),
    });
  },
  withIssueScope: (process) =>
    support.withGitHubIssueSync((scope) =>
      process(webhookTransactionFromScope(scope)),
    ),
};

async function escalationInput(
  workspaceId: string,
  ticketId: string,
): Promise<EscalationTicket> {
  const ticket = await support.getTicketForProject(
    workspaceId,
    projectId,
    ticketId,
  );
  const submission = await support.getTicketSubmissionText(projectId, ticketId);
  if (!ticket || !submission) throw new Error("Ticket vanished");
  const [classification, override, contact] = await Promise.all([
    support.getCurrentClassificationForProject(
      workspaceId,
      projectId,
      ticketId,
    ),
    support.getLatestOverride(workspaceId, projectId, ticketId),
    support.getConversationContact(projectId, ticket.conversationId),
  ]);
  return {
    ticketId,
    projectId,
    workspaceId,
    ticketNumber: ticket.ticketNumber,
    ticketReference: ticketReference(ticket.ticketNumber),
    status: ticket.status,
    route: ticket.route,
    reportedAt: ticket.createdAt,
    message: submission.message,
    categoryHint: submission.categoryHint,
    contact: contact
      ? { name: contact.visitorName, email: contact.visitorEmail }
      : null,
    classification: classification
      ? {
          type: classification.type,
          severity: classification.severity,
          confidence: classification.confidence,
          route: classification.route,
          githubIssueRecommended: classification.githubIssueRecommended,
          source: classification.source,
        }
      : null,
    override: override?.effective
      ? {
          route: override.effective.route,
          githubIssueRecommended: override.effective.githubIssueRecommended,
        }
      : null,
  };
}

async function state(workspaceId: string, ticketId: string) {
  const [ticket, link] = await Promise.all([
    support.getTicketForProject(workspaceId, projectId, ticketId),
    support.getGitHubIssueForTicket(workspaceId, projectId, ticketId),
  ]);
  return { ticket: ticket?.status, link: link?.status };
}

try {
  // Preconditions: the connected integration is exactly the disposable repo.
  const context = await support.getProjectWorkspace(projectId);
  if (!context) fail(`Project ${projectId} not found.`);
  const { workspaceId } = context;
  const project = await support.getProjectForWorkspace(workspaceId, projectId);
  const integration = await support.getIntegrationForProject(
    workspaceId,
    projectId,
  );
  if (!project || !integration || integration.status !== "active") {
    fail("Project has no active GitHub integration.");
  }
  if (
    integration.repositoryOwner !== expectedOwner ||
    integration.repositoryName !== expectedName
  ) {
    fail(
      `Connected repository is ${integration.repositoryOwner}/${integration.repositoryName}, not ${repositoryArg}.`,
    );
  }
  const app = new App({ appId, privateKey });
  const appSlug = (await app.octokit.request("GET /app")).data?.slug;
  const octokit = await app.getInstallationOctokit(
    Number(integration.installationId),
  );
  const repo = { owner: expectedOwner, repo: expectedName };
  interface Delivery {
    /** Kept as a string: delivery IDs exceed Number.MAX_SAFE_INTEGER. */
    id: string | number;
    guid: string;
    event: string;
    action: string | null;
    redelivery: boolean;
    status_code: number;
  }
  /**
   * App-JWT request that keeps webhook delivery IDs as strings: they exceed
   * Number.MAX_SAFE_INTEGER, so ordinary JSON parsing corrupts them.
   */
  async function appApi<T = unknown>(method: string, path: string) {
    const { token } = (await app.octokit.auth({ type: "app" })) as {
      token: string;
    };
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub App API ${method} ${path}: ${response.status}`);
    }
    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text, (key, value, context?: { source?: string }) =>
      key === "id" &&
      typeof value === "number" &&
      !Number.isSafeInteger(value) &&
      context?.source
        ? context.source
        : value,
    ) as T;
  }
  const remoteRepository = await octokit.request(
    "GET /repos/{owner}/{repo}",
    repo,
  );
  if (
    String(remoteRepository.data.id) !== integration.repositoryId.toString()
  ) {
    fail("Repository ID from GitHub does not match the stored integration.");
  }
  process.stdout.write(
    `Live journey against ${repositoryArg} (App ${appSlug}, installation ${integration.installationId}).\n`,
  );

  // Step 5: submit through the running public API with synthetic contact data.
  const runId = randomUUID();
  const contact = {
    name: "Live Validation Visitor",
    email: `live-${runId.slice(0, 8)}@example.test`,
  };
  const body = {
    projectKey: project.publicKey,
    category: "bug",
    message: `The projects section becomes blank in Safari when I switch the site to dark mode. Live validation run ${runId}.`,
    contact,
    submissionId: randomUUID(),
  };
  const submit = () =>
    fetch(new URL("/api/v1/support/tickets", platform), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const first = await submit().catch(() =>
    fail(
      `Platform not reachable at ${platform.origin}; start it (with the webhook tunnel) before a live run.`,
    ),
  );
  const accepted = (await first.json()) as { ticketReference?: string };
  if (!check("5 submit", first.status === 201, `HTTP ${first.status}`)) {
    process.exit(1);
  }
  const retry = await submit();
  const repeated = (await retry.json()) as { ticketReference?: string };
  check(
    "5 idempotent retry",
    retry.status === 201 &&
      repeated.ticketReference === accepted.ticketReference,
    `${accepted.ticketReference} → ${repeated.ticketReference}`,
  );
  const reference = accepted.ticketReference ?? "";
  const ticket = (
    await support.listTicketsForProject(workspaceId, projectId)
  ).find((row) => ticketReference(row.ticketNumber) === reference);
  if (!ticket) fail(`Accepted ticket ${reference} not found in DATABASE_URL.`);
  check(
    "5 persisted",
    ticket.status === "needs_triage" && ticket.categoryHint === "bug",
    `${reference} status=${ticket.status} hint=${ticket.categoryHint}`,
  );

  // Step 6: triage. Live Jev quality is observed, not asserted.
  const triaged = await triageTicket(
    {
      getCurrentClassification: (input) =>
        support
          .getCurrentClassificationForProject(
            input.workspaceId,
            input.projectId,
            input.ticketId,
          )
          .then((row) =>
            row ? { type: row.type, route: row.route } : undefined,
          ),
      appendClassification: (input) =>
        support.appendClassification(input.workspaceId, {
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
        support.recordTicketEvent(input).then(() => {}),
    },
    createClassifier(),
    {
      ticketId: ticket.id,
      projectId,
      workspaceId,
      status: ticket.status,
      message: body.message,
      categoryHint: "bug",
    },
  );
  process.stdout.write(
    `      triage (${classifierKind}): ${JSON.stringify(triaged)}\n`,
  );
  if (
    !check(
      "6 triage eligible",
      triaged.outcome === "classified" && triaged.githubEligible,
      triaged.outcome === "classified"
        ? `type=${triaged.type} route=${triaged.route} confidence=${triaged.confidence}`
        : triaged.outcome,
    )
  ) {
    fail("Ticket is not GitHub-eligible; stopping before any GitHub call.");
  }

  // Fixture triage is not evidence a live issue is warranted: record the
  // owner recommendation a human would give, as the dashboard override does.
  if (classifierKind === "mock") {
    const operator = operatorEmail
      ? await support.findUserByEmail(operatorEmail)
      : undefined;
    if (!operator) {
      fail(
        "Mock triage needs an operator account (--operator-email or SEED_OWNER_EMAIL).",
      );
    }
    await support.recordTicketOverride(
      workspaceId,
      {
        projectId,
        ticketId: ticket.id,
        decidedBy: operator.id,
        githubIssueRecommended: true,
        reason: `Live validation run ${runId}: operator recommends escalation of this synthetic bug.`,
      },
      "rerouted",
    );
    check("6 owner recommendation", true, "recorded for fixture triage");
  }

  // Step 7: preview must target the connected repository.
  const input = await escalationInput(workspaceId, ticket.id);
  const preview = previewEscalation({
    ticket: input,
    integration: {
      repositoryOwner: integration.repositoryOwner,
      repositoryName: integration.repositoryName,
      status: integration.status,
    },
  });
  if (
    !check(
      "7 preview",
      preview.state === "eligible" &&
        preview.repository.owner === expectedOwner &&
        preview.repository.repo === expectedName,
      preview.state,
    )
  ) {
    process.exit(1);
  }

  // Step 8: confirmed creation through the real GitHub App.
  const trackers = createTrackerFactory({ appId, privateKey });
  const outcome = await escalateTicketToGitHub({
    repository: port,
    trackers,
    ticket: input,
  });
  if (
    !check(
      "8 create",
      outcome.outcome === "created",
      "issue" in outcome ? (outcome.issue.url ?? "") : JSON.stringify(outcome),
    ) ||
    outcome.outcome !== "created"
  ) {
    process.exit(1);
  }
  const again = await escalateTicketToGitHub({
    repository: port,
    trackers,
    ticket: await escalationInput(workspaceId, ticket.id),
  });
  check(
    "8 repeat create reuses link",
    again.outcome === "already-linked" &&
      again.issue.number === outcome.issue.number,
    again.outcome,
  );
  const link = await support.getGitHubIssueForTicket(
    workspaceId,
    projectId,
    ticket.id,
  );
  check(
    "8 link persisted",
    link?.status === "open" &&
      link.githubIssueId === BigInt(outcome.issue.id) &&
      link.issueNumber === outcome.issue.number &&
      link.repositoryId === integration.repositoryId &&
      link.integrationId === integration.id,
    `#${link?.issueNumber} ${link?.status}`,
  );
  check(
    "8 ticket unchanged by creation",
    (await state(workspaceId, ticket.id)).ticket === "queued",
    "queued",
  );

  // Steps 9–10: inspect what GitHub actually published.
  const remote = (
    await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
      ...repo,
      issue_number: outcome.issue.number,
    })
  ).data;
  const published = `${remote.title}\n${remote.body ?? ""}\n${remote.labels
    .map((label) => (typeof label === "string" ? label : label.name))
    .join(",")}`;
  const leaks = [
    contact.name,
    contact.email,
    "example.test",
    ticket.id,
    ticket.conversationId,
    projectId,
    workspaceId,
    integration.id,
    project.publicKey,
    body.submissionId,
  ].filter((value) => published.includes(value));
  check(
    "9 no private data published",
    leaks.length === 0,
    leaks.length === 0
      ? "none found"
      : `${leaks.length} private value(s) found`,
  );
  check(
    "9 labels allowlisted",
    remote.labels.every((label) =>
      (ISSUE_LABEL_ALLOWLIST as readonly string[]).includes(
        typeof label === "string" ? label : (label.name ?? ""),
      ),
    ),
    remote.labels
      .map((label) => (typeof label === "string" ? label : label.name))
      .join(", ") || "none",
  );
  const markerLines = (remote.body ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() === link?.reconciliationMarker);
  check(
    "10 marker",
    markerLines.length === 1 &&
      /^<!-- ai-support-ticket:SUP-\d+:[0-9a-f]{32} -->$/.test(
        link?.reconciliationMarker ?? "",
      ),
    link?.reconciliationMarker ?? "missing",
  );
  check(
    "10 remote identity",
    remote.id === outcome.issue.id &&
      remote.user?.login === `${appSlug}[bot]` &&
      remote.user?.type === "Bot" &&
      !remote.pull_request &&
      remote.title.startsWith(`[${reference}] Reported bug:`),
    `${remote.user?.login} (${remote.user?.type})`,
  );
  // The issue listing (also used by reconciliation) is eventually consistent:
  // a just-created issue can be missing for a few seconds, so poll it.
  const markerCopies = await waitFor(async () => {
    const recent = await octokit.request("GET /repos/{owner}/{repo}/issues", {
      ...repo,
      state: "all",
      per_page: 100,
      sort: "created",
      direction: "desc",
    });
    const copies = recent.data.filter((candidate) =>
      candidate.body?.includes(link?.reconciliationMarker ?? "\u0000"),
    ).length;
    return copies > 0 ? copies : undefined;
  }, 30_000);
  check(
    "10 single remote issue",
    markerCopies === 1,
    `${markerCopies ?? 0} found in the repository listing`,
  );

  // Steps 11–12: close in GitHub; the signed webhook must resolve the ticket.
  await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
    ...repo,
    issue_number: outcome.issue.number,
    state: "closed",
    state_reason: "completed",
  });
  const closed = await waitFor(async () => {
    const current = await state(workspaceId, ticket.id);
    return current.link === "closed" && current.ticket === "resolved"
      ? current
      : undefined;
  }, webhookTimeoutMs);
  if (
    !check(
      "11–12 close webhook resolves ticket",
      closed !== undefined,
      closed
        ? "link closed, ticket resolved"
        : "timed out: check the App webhook URL, Issues subscription, tunnel, and Recent Deliveries",
    )
  ) {
    process.exit(1);
  }

  // Steps 13–14: reopen in GitHub; the ticket returns to the active queue.
  await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
    ...repo,
    issue_number: outcome.issue.number,
    state: "open",
  });
  const reopened = await waitFor(async () => {
    const current = await state(workspaceId, ticket.id);
    return current.link === "open" && current.ticket === "queued"
      ? current
      : undefined;
  }, webhookTimeoutMs);
  if (
    !check(
      "13–14 reopen webhook reopens ticket",
      reopened !== undefined,
      reopened ? "link open, ticket queued" : "timed out",
    )
  ) {
    process.exit(1);
  }

  // Redeliver the original close: the same delivery ID must be a no-op.
  const eventsBefore = await support.listTicketEvents(projectId, ticket.id);
  const deliveries = await appApi<Delivery[]>(
    "GET",
    "/app/hook/deliveries?per_page=50",
  );
  let closeDelivery: Delivery | undefined;
  for (const delivery of deliveries) {
    if (delivery.event !== "issues" || delivery.action !== "closed") continue;
    const detail = await appApi<{
      request?: { payload?: { issue?: { id?: number } } };
    }>("GET", `/app/hook/deliveries/${delivery.id}`);
    if (detail.request?.payload?.issue?.id === outcome.issue.id) {
      closeDelivery = delivery;
      break;
    }
  }
  if (closeDelivery) {
    const original = closeDelivery;
    await appApi("POST", `/app/hook/deliveries/${original.id}/attempts`);
    const redelivered = await waitFor(async () => {
      const list = await appApi<Delivery[]>(
        "GET",
        "/app/hook/deliveries?per_page=50",
      );
      return list.find(
        (delivery) =>
          delivery.guid === original.guid &&
          delivery.redelivery &&
          delivery.status_code > 0,
      );
    }, webhookTimeoutMs);
    const eventsAfter = await support.listTicketEvents(projectId, ticket.id);
    const after = await state(workspaceId, ticket.id);
    check(
      "16 close redelivery is a no-op",
      redelivered?.status_code === 200 &&
        eventsAfter.length === eventsBefore.length &&
        after.ticket === "queued" &&
        after.link === "open",
      redelivered
        ? `HTTP ${redelivered.status_code}; events ${eventsBefore.length}→${eventsAfter.length}; ticket ${after.ticket}`
        : "redelivery not observed",
    );
  } else {
    check("16 close redelivery is a no-op", false, "close delivery not found");
  }

  // Step 15: ordered timeline with GitHub provenance and no contact data.
  const events = await support.listTicketEvents(projectId, ticket.id);
  const types = events.map((event) => event.type);
  const expected = [
    "submitted",
    "classified",
    "github_escalation_requested",
    "github_issue_created",
    "github_issue_closed",
    "ticket_resolved_from_github",
    "github_issue_reopened",
    "ticket_reopened_from_github",
  ];
  const ordered = expected.every(
    (type, index) =>
      types.indexOf(type) >= 0 &&
      (index === 0 ||
        types.indexOf(type) > types.indexOf(expected[index - 1] ?? "")),
  );
  const auditText = JSON.stringify(events.map((event) => event.summary));
  check(
    "15 timeline",
    ordered &&
      types.filter((type) => type === "ticket_resolved_from_github").length ===
        1 &&
      !auditText.includes(contact.email) &&
      !auditText.includes(contact.name),
    types.join(" → "),
  );

  // Leave the disposable repository tidy: close again and confirm the sync.
  if (finish === "closed") {
    await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
      ...repo,
      issue_number: outcome.issue.number,
      state: "closed",
      state_reason: "completed",
    });
    const final = await waitFor(async () => {
      const current = await state(workspaceId, ticket.id);
      return current.link === "closed" && current.ticket === "resolved"
        ? current
        : undefined;
    }, webhookTimeoutMs);
    check(
      "finish closed",
      final !== undefined,
      final ? "issue closed, ticket resolved" : "timed out",
    );
  }

  const failed = results.filter((result) => !result.ok);
  process.stdout.write(
    `\n${results.length - failed.length}/${results.length} live checks passed. Issue left ${finish}: ${outcome.issue.url}\n`,
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
} finally {
  await pool.end();
}
