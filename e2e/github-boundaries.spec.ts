import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  clickCreateUntilSuccess,
  clickUntilSettled,
  deliverWebhook,
  issuesPayload,
  login,
  mockIssueFor,
  openTicket,
  PLATFORM,
  signature,
} from "./helpers";

const PORTFOLIO_PROJECT = "20000000-0000-4000-8000-000000000001";
const DEMO_PROJECT_KEY = `pk_${"A".repeat(32)}`;

test("the webhook endpoint rejects forged or malformed deliveries without touching the linked ticket", async ({
  page,
  request,
}) => {
  const created = await request.post(`${PLATFORM}/api/v1/support/tickets`, {
    data: {
      projectKey: DEMO_PROJECT_KEY,
      category: "bug",
      message: `E2E boundary probe ${randomUUID()}: the export page is blank.`,
      submissionId: randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const { ticketReference: reference } = await created.json();
  await login(page);
  await openTicket(page, reference);
  await clickUntilSettled(
    page,
    "Re-run AI triage",
    /Classified as |Action failed/,
  );
  await page.waitForLoadState("networkidle");
  await clickCreateUntilSuccess(page);
  const ticketId = new URL(page.url()).pathname.split("/").at(-1);
  if (!ticketId) throw new Error("Ticket URL missing ID");
  const issue = mockIssueFor(reference, ticketId);
  const close = issuesPayload("closed", issue);

  const rejected = [
    [
      "missing signature",
      () =>
        deliverWebhook(request, close, { "X-Hub-Signature-256": undefined }),
      401,
      { ok: false, error: "INVALID_SIGNATURE" },
    ],
    [
      "wrong secret",
      () =>
        deliverWebhook(request, close, {
          "X-Hub-Signature-256": signature(close, "not-the-webhook-secret"),
        }),
      401,
      { ok: false, error: "INVALID_SIGNATURE" },
    ],
    [
      "body changed after signing",
      () =>
        deliverWebhook(request, close.replace('"closed"', '"closed" '), {
          "X-Hub-Signature-256": signature(close),
        }),
      401,
      { ok: false, error: "INVALID_SIGNATURE" },
    ],
    [
      "missing delivery ID",
      () => deliverWebhook(request, close, { "X-GitHub-Delivery": undefined }),
      400,
      { ok: false, error: "INVALID_DELIVERY" },
    ],
    [
      "non-UUID delivery ID",
      () => deliverWebhook(request, close, { "X-GitHub-Delivery": "1234" }),
      400,
      { ok: false, error: "INVALID_DELIVERY" },
    ],
    [
      "signed malformed JSON",
      () => deliverWebhook(request, "{not json"),
      400,
      { ok: false, error: "INVALID_PAYLOAD" },
    ],
  ] as const;
  for (const [label, send, status, body] of rejected) {
    const response = await send();
    expect(response.status(), label).toBe(status);
    expect(await response.json(), label).toEqual(body);
  }

  // Authenticated but not ours: acknowledged, never applied.
  for (const [label, raw] of [
    [
      "other repository",
      issuesPayload("closed", issue, { repositoryId: 1000 }),
    ],
    [
      "other installation",
      issuesPayload("closed", issue, { installationId: 1000 }),
    ],
    [
      "unknown issue",
      issuesPayload("closed", { id: issue.id + 1, number: issue.number }),
    ],
    [
      "wrong issue number",
      issuesPayload("closed", { id: issue.id, number: issue.number + 1 }),
    ],
    [
      "schema-invalid payload",
      JSON.stringify({ action: "closed", issue: { id: "x" } }),
    ],
  ] as const) {
    const response = await deliverWebhook(request, raw);
    expect(response.status(), label).toBe(200);
    expect(await response.json(), label).toEqual({
      ok: true,
      outcome: "ignored",
    });
  }

  await page.reload();
  const github = page
    .getByRole("region", { name: "GitHub escalation" })
    .getByRole("status");
  await expect(github).toContainText("Open");
  await expect(
    page
      .getByRole("heading", { level: 2, name: reference })
      .locator("xpath=.."),
  ).toContainText("queued");
  await expect(page.getByText(/Resolved because GitHub issue/)).toHaveCount(0);

  // The genuine delivery still works, proving the rejections were meaningful.
  expect(await (await deliverWebhook(request, close)).json()).toEqual({
    ok: true,
    outcome: "processed",
  });
  await page.reload();
  await expect(github).toContainText("Closed");
});

test("the dashboard GitHub action requires a session, same Origin, and workspace access", async ({
  page,
  playwright,
}) => {
  const anonymous = await playwright.request.newContext();
  const endpoint = `${PLATFORM}/api/dashboard/tickets/${randomUUID()}/github`;
  const unauthenticated = await anonymous.post(endpoint, {
    data: { projectId: PORTFOLIO_PROJECT, action: "create" },
    headers: { Origin: PLATFORM },
  });
  expect(unauthenticated.status()).toBe(401);
  expect(await unauthenticated.json()).toEqual({
    ok: false,
    error: "UNAUTHENTICATED",
  });
  // Without an Origin header the request is refused before any session lookup.
  const originlessAnonymous = await anonymous.post(endpoint, {
    data: { projectId: PORTFOLIO_PROJECT, action: "create" },
  });
  expect(originlessAnonymous.status()).toBe(404);
  expect(await originlessAnonymous.json()).toEqual({
    ok: false,
    error: "FORBIDDEN",
  });
  await anonymous.dispose();

  await login(page);
  const forged = await page.request.post(endpoint, {
    data: { projectId: PORTFOLIO_PROJECT, action: "create" },
    headers: { Origin: "https://evil.example" },
  });
  expect(forged.status()).toBe(404);
  expect(await forged.json()).toEqual({ ok: false, error: "FORBIDDEN" });

  // Mutations must carry a same-origin Origin header, even with a session.
  const originless = await page.request.post(endpoint, {
    data: { projectId: PORTFOLIO_PROJECT, action: "preview" },
  });
  expect(originless.status()).toBe(404);
  expect(await originless.json()).toEqual({ ok: false, error: "FORBIDDEN" });

  // An unknown or foreign project is indistinguishable from a missing one.
  const sameOrigin = { Origin: PLATFORM };
  const foreign = await page.request.post(endpoint, {
    data: { projectId: randomUUID(), action: "preview" },
    headers: sameOrigin,
  });
  expect(foreign.status()).toBe(404);
  expect(await foreign.json()).toEqual({ ok: false, error: "NOT_FOUND" });

  const missingTicket = await page.request.post(endpoint, {
    data: { projectId: PORTFOLIO_PROJECT, action: "preview" },
    headers: sameOrigin,
  });
  expect(missingTicket.status()).toBe(404);
  expect(await missingTicket.json()).toEqual({ ok: false, error: "NOT_FOUND" });

  // Public ingestion stays credential-free by design.
  const publicSubmission = await playwright.request.newContext();
  const accepted = await publicSubmission.post(
    `${PLATFORM}/api/v1/support/tickets`,
    {
      data: {
        projectKey: DEMO_PROJECT_KEY,
        category: "question",
        message: `E2E anonymous question ${randomUUID()}?`,
        submissionId: randomUUID(),
      },
    },
  );
  expect(accepted.status()).toBe(201);
  await publicSubmission.dispose();
});
