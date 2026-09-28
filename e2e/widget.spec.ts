import { expect, test } from "@playwright/test";
import { DEMO } from "./e2e-env";

test("demo visitor submits a bug and sees a confirmation", async ({ page }) => {
  await page.goto(`${DEMO}/`);
  await page.getByRole("button", { name: "Open support" }).click();
  await expect(page.getByRole("dialog")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await page.getByRole("button", { name: /Report a bug/ }).click();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("The projects page is blank in Safari dark mode.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Message received")).toBeVisible();
  await expect(page.getByText("SUP-DEMO-001")).toBeVisible();
});

test("mobile dark widget fits the viewport and supports failure retry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${DEMO}/`);
  await page.getByLabel("Theme").selectOption("dark");
  await page.getByLabel("Simulate submission failure").check();
  await page.getByRole("button", { name: "Open support" }).click();
  await expect(page.getByRole("dialog")).toHaveCSS(
    "background-color",
    "rgb(21, 28, 43)",
  );
  await page.getByRole("button", { name: /Ask a question/ }).click();
  await page
    .getByRole("textbox", { name: "Message" })
    .fill("What technologies did you use to build this site?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByText("We couldn’t send your message. Please try again."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close support" }).click();
  await page.getByLabel("Simulate submission failure").uncheck();
  await page.getByRole("button", { name: "Open support" }).click();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("SUP-DEMO-001")).toBeVisible();
  const dialog = page.getByRole("dialog");
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
});
