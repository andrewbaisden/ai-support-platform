import { expect, test } from "@playwright/test";

test("platform and demo shells are reachable", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "AI Support Platform" }),
  ).toBeVisible();

  await page.goto("http://127.0.0.1:3001/");
  await expect(
    page.getByRole("heading", { name: "Demo Consumer" }),
  ).toBeVisible();
});
