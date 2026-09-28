import { expect, type Page, test } from "@playwright/test";
import { E2E_SETUP_TOKEN, PLATFORM, SETUP_PLATFORM } from "./e2e-env";

// The setup server's database is recreated empty for every run (see
// global-setup), so these steps run once, in order, on a fresh install.
test.describe.configure({ mode: "serial" });

const OWNER = {
  name: "Self Host Owner",
  email: "self-host-owner@local.example",
  password: "a-long-local-e2e-password",
};

async function signIn(page: Page) {
  await page.goto(`${SETUP_PLATFORM}/login`);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

test("setup is closed on an installation that already has accounts", async ({
  request,
}) => {
  expect((await request.get(`${PLATFORM}/setup`)).status()).toBe(404);
  const response = await request.post(`${PLATFORM}/api/setup`, {
    headers: { Origin: PLATFORM },
    data: {},
  });
  expect(response.status()).toBe(404);
});

test("first-run setup creates the owner and shows the widget key", async ({
  page,
  request,
}) => {
  await page.goto(`${SETUP_PLATFORM}/setup`);
  await expect(
    page.getByRole("heading", { name: "Set up IssueRelay" }),
  ).toBeVisible();

  const form = page.getByRole("form", { name: "Set up IssueRelay" });
  await form.getByLabel("Setup token").fill("not-the-right-setup-token");
  await form.getByLabel("Your name").fill(OWNER.name);
  await form.getByLabel("Email").fill(OWNER.email);
  await form.getByLabel("Password", { exact: true }).fill(OWNER.password);
  await form.getByLabel("Confirm password").fill(OWNER.password);
  await form.getByLabel("Site name").fill("My site");
  await form.getByLabel("Site address").fill("https://site.example.test/");
  await form.getByRole("button", { name: "Set up IssueRelay" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toHaveText(
    "That setup token is not correct.",
  );

  await form.getByLabel("Setup token").fill(E2E_SETUP_TOKEN);
  await form.getByRole("button", { name: "Set up IssueRelay" }).click();
  await expect(page.getByRole("status")).toContainText("IssueRelay is set up");
  await expect(page.getByText(/^pk_[A-Za-z0-9_-]{32}$/)).toBeVisible();
  await expect(page.getByText(`apiBaseUrl: "${SETUP_PLATFORM}"`)).toBeVisible();

  // Closed for good once the owner exists, even with the right token.
  expect((await request.get(`${SETUP_PLATFORM}/setup`)).status()).toBe(404);
  const again = await request.post(`${SETUP_PLATFORM}/api/setup`, {
    headers: { Origin: SETUP_PLATFORM },
    data: { token: E2E_SETUP_TOKEN },
  });
  expect(again.status()).toBe(404);

  await page.getByRole("link", { name: "Sign in to the dashboard" }).click();
  await signIn(page);
  await expect(page.getByRole("heading", { name: "My site" })).toBeVisible();
});

test("owner manages the key, site addresses, and repository in settings", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: SETUP_PLATFORM,
  });
  await signIn(page);
  await page.getByRole("link", { name: "My site settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Project settings" }),
  ).toBeVisible();

  const key = await page
    .locator("code", { hasText: /^pk_[A-Za-z0-9_-]{32}$/ })
    .textContent();
  // Dev-server hydration can lag the first paint; retry until it copies.
  await expect(async () => {
    await page.getByRole("button", { name: /widget key$/ }).click();
    await expect(
      page.getByRole("button", { name: "Copied widget key" }),
    ).toBeVisible({ timeout: 1_000 });
  }).toPass();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

  const origins = page.getByRole("list", { name: "Allowed origins" });
  await expect(origins).toContainText("https://site.example.test");
  const add = page.getByLabel("Add site address");
  await add.fill("https://site.example.test/some/page");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText(
    "with no path",
  );
  await add.fill("https://www.site.example.test/");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(origins).toContainText("https://www.site.example.test");
  await page
    .getByRole("button", { name: "Remove https://site.example.test" })
    .click();
  await expect(origins).not.toContainText(/https:\/\/site\.example\.test/);
  await page.reload();
  const saved = page.getByRole("list", { name: "Allowed origins" });
  await expect(saved.getByRole("listitem")).toHaveCount(1);
  await expect(saved).toContainText("https://www.site.example.test");

  const repository = page.getByLabel("Repository (owner/name)");
  await repository.fill("example/not-installed-site");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /./ })).toContainText(
    "not installed",
  );
  await expect(
    page.getByRole("link", { name: "Install the GitHub App" }),
  ).toHaveAttribute("href", /\/installations\/new$/);

  await repository.fill("https://github.com/Example/My-Site");
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByText("Connected to example/my-site")).toBeVisible();
});
