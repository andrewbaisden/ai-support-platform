import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const WEB_API = "http://127.0.0.1:3000/api/v1/support/tickets";
const DEMO_PROJECT_KEY = `pk_${"A".repeat(32)}`;
const MESSAGE = "The projects page is blank in Safari dark mode.";

// Requires a migrated and seeded development database:
//   pnpm db:migrate && pnpm db:seed
// The seed provides the demo project key with the demo origin allowed.
test("demo visitor submits through the real ingestion API and sees a ticket reference", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3001/");
  await page.getByLabel("Submission mode").selectOption("real");
  await page.getByRole("button", { name: "Open support" }).click();
  await page.getByRole("button", { name: /Report a bug/ }).click();
  await page.getByRole("textbox", { name: "Message" }).fill(MESSAGE);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Message received")).toBeVisible();
  await expect(page.getByText(/SUP-\d+/)).toBeVisible();
});

test("public API returns the same ticket on idempotent retry", async ({
  request,
}) => {
  const body = {
    projectKey: DEMO_PROJECT_KEY,
    category: "bug",
    message: `${MESSAGE} Retry ${randomUUID()}.`,
    submissionId: randomUUID(),
  };
  const first = await request.post(WEB_API, { data: body });
  expect(first.status()).toBe(201);
  const firstJson = await first.json();
  expect(firstJson.ticketReference).toMatch(/^SUP-[1-9][0-9]*$/);

  const second = await request.post(WEB_API, { data: body });
  expect(second.status()).toBe(201);
  expect(await second.json()).toEqual(firstJson);
});

test("public API rejects unknown projects and disallowed origins safely", async ({
  request,
}) => {
  const unknown = await request.post(WEB_API, {
    data: {
      projectKey: `pk_${"Z".repeat(32)}`,
      category: "bug",
      message: MESSAGE,
      submissionId: randomUUID(),
    },
  });
  expect(unknown.status()).toBe(404);
  expect(await unknown.json()).toEqual({
    error: { code: "PROJECT_NOT_FOUND" },
  });

  const disallowed = await request.post(WEB_API, {
    data: {
      projectKey: DEMO_PROJECT_KEY,
      category: "bug",
      message: MESSAGE,
      submissionId: randomUUID(),
    },
    headers: { Origin: "https://evil.example" },
  });
  expect(disallowed.status()).toBe(403);
  expect(await disallowed.json()).toEqual({
    error: { code: "ORIGIN_NOT_ALLOWED" },
  });
});
