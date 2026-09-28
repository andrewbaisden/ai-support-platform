import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import {
  clickCreateUntilSuccess,
  clickUntilSettled,
  DEMO,
  deliverWebhook,
  issuesPayload,
  login,
  MOCK_REPOSITORY,
  mockIssueFor,
  openTicket,
} from "./helpers";

// Synthetic contact data: present so privacy assertions are meaningful.
const VISITOR = { name: "Ada Tester", email: "ada.tester@example.test" };

async function timeline(page: Page) {
  const items = await page
    .getByRole("region", { name: "Timeline" })
    .getByRole("listitem")
    .allTextContents();
  return items.map((text) => text.trim().split(/\s/)[0] ?? "");
}

function statusBadge(page: Page, reference: string) {
  return page
    .getByRole("heading", { level: 2, name: reference })
    .locator("xpath=..");
}

function githubStatus(page: Page) {
  return page
    .getByRole("region", { name: "GitHub escalation" })
    .getByRole("status");
}

/**
 * Steps 5–15 through the real widget, ingestion API, database, dashboard
 * and auth, triage service (fixture classifier), escalation service, and
 * webhook route with real HMAC. Only GitHub's network is the mock tracker.
 */
test("a widget bug report travels to a GitHub issue and back through signed webhooks", async ({
  page,
  request,
}) => {
  const message = `The projects section becomes blank in Safari when I switch the site to dark mode. Journey ${randomUUID()}`;

  // Step 5: the visitor reports a bug through the real widget and API.
  await page.goto(`${DEMO}/`);
  await page.getByLabel("Submission mode").selectOption("real");
  await page.getByRole("button", { name: "Open support" }).click();
  await page.getByRole("button", { name: /Report a bug/ }).click();
  await page.getByRole("textbox", { name: "Message" }).fill(message);
  await page.getByLabel("Name (optional)").fill(VISITOR.name);
  await page.getByLabel("Email (optional)").fill(VISITOR.email);
  const submission = page.waitForRequest(
    (req) =>
      req.method() === "POST" && req.url().includes("/api/v1/support/tickets"),
  );
  const accepted = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/v1/support/tickets"),
  );
  await page.getByRole("button", { name: "Send message" }).click();
  const sent = (await submission).postDataJSON();
  expect(sent).toMatchObject({
    category: "bug",
    message,
    contact: VISITOR,
  });
  expect(sent.submissionId).toMatch(/^[0-9a-f-]{36}$/);
  const response = await accepted;
  expect(response.status()).toBe(201);
  const { ticketReference: reference } = await response.json();
  expect(reference).toMatch(/^SUP-\d+$/);
  await expect(page.getByText("Message received")).toBeVisible();
  await expect(page.getByText(reference)).toBeVisible();

  // The operator finds one private ticket awaiting triage.
  await login(page);
  await openTicket(page, reference);
  await expect(statusBadge(page, reference)).toContainText("needs_triage");
  const report = page.getByRole("region", { name: "Visitor report" });
  await expect(report).toContainText(message);
  await expect(report).toContainText(VISITOR.name);
  await expect(report).toContainText(VISITOR.email);
  expect(await timeline(page)).toEqual(["submitted"]);

  // Step 6: triage with the deterministic classifier.
  await clickUntilSettled(
    page,
    "Re-run AI triage",
    /Classified as |Action failed/,
  );
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(statusBadge(page, reference)).toContainText("queued");
  await expect(statusBadge(page, reference)).toContainText("engineering");
  await expect(report).toContainText("bug");
  await expect(
    page.getByRole("region", { name: "Current AI classification" }),
  ).toContainText("bug");

  // Step 7: the preview targets the connected repository and excludes contact data.
  const github = page.getByRole("region", { name: "GitHub escalation" });
  await expect(github).toContainText(
    `Target repository: ${MOCK_REPOSITORY.owner}/${MOCK_REPOSITORY.name}`,
  );
  await github.getByText("Preview issue content").click();
  const preview = await github.locator("details").innerText();
  expect(preview).toContain(`[${reference}] Reported bug:`);
  expect(preview).toContain("not a calibrated probability");
  expect(preview).toContain(`ai-support-ticket:${reference}:`);
  expect(preview).not.toContain(VISITOR.name);
  expect(preview).not.toContain(VISITOR.email);
  const ticketId = new URL(page.url()).pathname.split("/").at(-1);
  if (!ticketId) throw new Error("Ticket URL missing ID");
  expect(preview).not.toContain(ticketId);
  expect(await timeline(page)).not.toContain("github_escalation_requested");

  // Step 8: explicit confirmation creates and links one issue.
  await clickCreateUntilSuccess(page);
  const issue = mockIssueFor(reference, ticketId);
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(githubStatus(page)).toContainText(`#${issue.number}`);
  await expect(githubStatus(page)).toContainText("Open");
  expect(await githubStatus(page).getByRole("link").getAttribute("href")).toBe(
    `https://github.com/${MOCK_REPOSITORY.owner}/${MOCK_REPOSITORY.name}/issues/${issue.number}`,
  );
  await expect(
    page.getByRole("button", { name: "Create GitHub issue" }),
  ).toHaveCount(0);
  await expect(statusBadge(page, reference)).toContainText("queued");

  // Steps 11–12: a signed close resolves the ticket; replays do nothing.
  const close = issuesPayload("closed", issue);
  const closeDelivery = randomUUID();
  const closed = await deliverWebhook(request, close, {
    "X-GitHub-Delivery": closeDelivery,
  });
  expect(closed.status()).toBe(200);
  expect(await closed.json()).toEqual({ ok: true, outcome: "processed" });
  const replay = await deliverWebhook(request, close, {
    "X-GitHub-Delivery": closeDelivery,
  });
  expect(await replay.json()).toEqual({ ok: true, outcome: "duplicate" });
  expect((await deliverWebhook(request, close)).status()).toBe(200);
  await page.reload();
  await expect(githubStatus(page)).toContainText("Closed");
  await expect(statusBadge(page, reference)).toContainText("resolved");
  await expect(page.getByText(/Resolved because GitHub issue/)).toHaveCount(1);

  // Steps 13–14: a signed reopen returns the ticket to the active queue.
  const reopened = await deliverWebhook(
    request,
    issuesPayload("reopened", issue),
  );
  expect(await reopened.json()).toEqual({ ok: true, outcome: "processed" });
  // A late replay of the original close cannot regress the reopen.
  expect(
    await (
      await deliverWebhook(request, close, {
        "X-GitHub-Delivery": closeDelivery,
      })
    ).json(),
  ).toEqual({ ok: true, outcome: "duplicate" });
  await page.reload();
  await expect(githubStatus(page)).toContainText("Open");
  await expect(statusBadge(page, reference)).toContainText("queued");
  await expect(page.getByText(/Reopened because GitHub issue/)).toHaveCount(1);

  // Step 15: ordered, deduplicated timeline with GitHub provenance.
  const types = await timeline(page);
  const journey = [
    "submitted",
    "classified",
    "github_escalation_requested",
    "github_issue_created",
    "github_issue_closed",
    "ticket_resolved_from_github",
    "github_issue_reopened",
    "ticket_reopened_from_github",
  ];
  expect(types.filter((type) => journey.includes(type))).toEqual(
    // Dashboard re-triage retries may append extra `classified` rows.
    [
      "submitted",
      ...types.filter((type) => type === "classified"),
      ...journey.slice(2),
    ],
  );
  const timelineText = await page
    .getByRole("region", { name: "Timeline" })
    .innerText();
  expect(timelineText).not.toContain(VISITOR.name);
  expect(timelineText).not.toContain(VISITOR.email);
  await expect(
    page.getByRole("region", { name: "Classification history" }),
  ).toContainText("bug");
});
