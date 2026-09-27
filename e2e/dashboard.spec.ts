import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

const WEB_API = "http://127.0.0.1:3000/api/v1/support/tickets";
const DEMO_PROJECT_KEY = `pk_${"A".repeat(32)}`;
// Local development seed credentials only; see .env.example.
const OWNER_EMAIL = "owner@local.example";
const OWNER_PASSWORD = "change-me-local-dev-01";

async function login(page: Page) {
  await page.goto("http://127.0.0.1:3000/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

async function submitTicket(request: APIRequestContext, message: string) {
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
  expect(body.ticketReference).toMatch(/^SUP-[1-9][0-9]*$/);
  return body.ticketReference as string;
}

test("operator signs in and inspects a ticket", async ({ page }) => {
  await login(page);
  await expect(page.getByText("Andrew Demo Workspace")).toBeVisible();
  await page
    .locator("li", { hasText: "Portfolio Demo" })
    .getByRole("link", { name: "Open tickets" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tickets", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /SUP-\d+/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: /SUP-\d+/ })).toBeVisible();
  await expect(page.getByText("Visitor report")).toBeVisible();
  await expect(page.getByText("Timeline")).toBeVisible();
});

test("operator re-tries triage and sees history grow", async ({
  page,
  request,
}) => {
  const reference = await submitTicket(
    request,
    `E2E retriage probe ${randomUUID()}: the export page is blank and shows an error.`,
  );
  await login(page);
  await page
    .locator("li", { hasText: "Portfolio Demo" })
    .getByRole("link", { name: "Open tickets" })
    .click();
  await page.getByLabel("Reference").fill(reference);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("link", { name: reference }).click();
  // Client islands hydrate after dev chunk compilation; clicks before that
  // land on SSR HTML and never reach React.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Re-run AI triage" }).click();
  await expect(page.getByText(/Classified as bug/)).toBeVisible();
  await expect(page.getByText("Classification history")).toBeVisible();
  await expect(page.getByText("retriage_requested")).toBeVisible();
});

test("operator resolves a ticket and sees the timeline entry", async ({
  page,
  request,
}) => {
  const reference = await submitTicket(
    request,
    `E2E resolve probe ${randomUUID()}: the export page is blank and shows an error.`,
  );
  await login(page);
  await page
    .locator("li", { hasText: "Portfolio Demo" })
    .getByRole("link", { name: "Open tickets" })
    .click();
  await page.getByLabel("Reference").fill(reference);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("link", { name: reference }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByText("Ticket moved to resolved.")).toBeVisible();
  await expect(
    page.getByText("resolved", { exact: true }).first(),
  ).toBeVisible();
});

test("unauthenticated dashboard access redirects to login", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3000/dashboard");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
