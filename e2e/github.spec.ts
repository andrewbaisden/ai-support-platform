import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { clickCreateUntilSuccess, clickUntilSettled } from "./helpers";

const WEB_API = "http://127.0.0.1:3000/api/v1/support/tickets";
const DEMO_PROJECT_KEY = `pk_${"A".repeat(32)}`;
const OWNER_EMAIL = "owner@local.example";
const OWNER_PASSWORD = "change-me-local-dev-01";

async function login(page: Page) {
  await page.goto("http://127.0.0.1:3000/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

async function openTicket(page: Page, reference: string) {
  await page
    .locator("li", { hasText: "Portfolio Demo" })
    .getByRole("link", { name: "Open tickets" })
    .click();
  await page.getByLabel("Reference").fill(reference);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("link", { name: reference }).click();
  await page.waitForLoadState("networkidle");
}

async function submitBug(request: APIRequestContext, message: string) {
  const response = await request.post(WEB_API, {
    data: {
      projectKey: DEMO_PROJECT_KEY,
      category: "bug",
      message,
      submissionId: randomUUID(),
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  return body.ticketReference as string;
}

test("operator previews, confirms, and sees the linked issue", async ({
  page,
  request,
}) => {
  const reference = await submitBug(
    request,
    `E2E escalation probe ${randomUUID()}: the export page is blank and shows an error.`,
  );
  await login(page);
  await openTicket(page, reference);
  // Fixture triage is not automatic; classify via the dashboard first.
  await clickUntilSettled(
    page,
    "Re-run AI triage",
    /Classified as |Action failed/,
  );
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Preview issue content")).toBeVisible();
  await expect(page.getByText("example/disposable")).toBeVisible();
  await clickCreateUntilSuccess(page);
  await expect(page.getByText(/Issue created \(#\d+\)/)).toBeVisible();
  const link = page.getByRole("link", { name: /#\d+/ });
  await expect(link).toBeVisible();
  expect(await link.getAttribute("href")).toMatch(
    /^https:\/\/github\.com\/example\/disposable\/issues\/\d+$/,
  );
});

test("privacy-sensitive tickets are blocked from escalation", async ({
  page,
  request,
}) => {
  const reference = await submitBug(
    request,
    `E2E privacy probe ${randomUUID()}: the export page is blank, contact ada@example.com.`,
  );
  await login(page);
  await openTicket(page, reference);
  await clickUntilSettled(
    page,
    "Re-run AI triage",
    /Classified as |Action failed/,
  );
  await expect(page.getByText("GITHUB_PRIVACY_BLOCKED")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create GitHub issue" }),
  ).toHaveCount(0);
});

test("already-linked tickets show the issue instead of a create button", async ({
  page,
  request,
}) => {
  const reference = await submitBug(
    request,
    `E2E relink probe ${randomUUID()}: the export page is blank and shows an error.`,
  );
  await login(page);
  await openTicket(page, reference);
  await clickUntilSettled(
    page,
    "Re-run AI triage",
    /Classified as |Action failed/,
  );
  await page.waitForLoadState("networkidle");
  await clickCreateUntilSuccess(page);
  await expect(page.getByText(/Issue created \(#\d+\)/)).toBeVisible();
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Linked issue")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create GitHub issue" }),
  ).toHaveCount(0);
});
