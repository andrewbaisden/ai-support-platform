import { expect, test } from "@playwright/test";
import { DEMO } from "./e2e-env";

test("platform and demo shells are reachable", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "AI Support Platform" }),
  ).toBeVisible();

  await page.goto(`${DEMO}/`);
  await expect(
    page.getByRole("heading", { name: "Demo Consumer" }),
  ).toBeVisible();
});
