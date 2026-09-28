import { expect, type Page, test } from "@playwright/test";

// Record CSP violations from the first script onward (init scripts run via
// the browser protocol, outside the page's own policy).
async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
}

async function shadowStyling(page: Page) {
  return page.evaluate(() => {
    const host = [...document.querySelectorAll("div")].find(
      (element) => element.shadowRoot,
    );
    const root = host?.shadowRoot;
    return {
      adoptedSheets: root?.adoptedStyleSheets.length ?? 0,
      styleElements: root?.querySelectorAll("style").length ?? -1,
    };
  });
}

async function submitBug(page: Page, reference: string) {
  await page.getByRole("button", { name: "Open support" }).click();
  await page.getByRole("button", { name: /Report a bug/ }).click();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("The projects section is blank in Safari dark mode.");
  await page.getByLabel("Email (optional)").fill("visitor@example.test");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Message received")).toBeVisible();
  await expect(page.getByText(reference)).toBeVisible();
}

test("a strict-CSP Vite host styles and uses the packed widget with no violations", async ({
  page,
}) => {
  await watchCsp(page);
  const response = await page.goto("http://127.0.0.1:4173/");
  expect(response?.headers()["content-security-policy"]).toContain(
    "style-src 'self'",
  );
  await expect(
    page.getByRole("heading", { name: "External Vite consumer" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open support" }).click();
  // Styled means the ShadowRoot sheet applied despite style-src 'self'.
  await expect(page.getByRole("dialog")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  expect(await shadowStyling(page)).toEqual({
    adoptedSheets: 1,
    styleElements: 0,
  });
  await page.getByRole("button", { name: "Close support" }).click();
  await submitBug(page, "SUP-EXT-1");
  expect(
    await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp),
  ).toEqual([]);
});

test("a Next.js App Router host server-renders and hydrates the packed widget", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("http://127.0.0.1:4174/");
  await expect(
    page.getByRole("heading", { name: "External Next.js consumer" }),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Open support" }).click();
  // Dark theme applied inside the ShadowRoot.
  await expect(page.getByRole("dialog")).not.toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await page.getByRole("button", { name: "Close support" }).click();
  await submitBug(page, "SUP-EXT-2");
  expect(errors).toEqual([]);
});
