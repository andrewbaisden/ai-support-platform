import { expect, test } from "@playwright/test";
import { DEMO } from "./e2e-env";

test("platform and demo shells are reachable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "IssueRelay" })).toBeVisible();

  await page.goto(`${DEMO}/`);
  await expect(
    page.getByRole("heading", { name: "Demo Consumer" }),
  ).toBeVisible();
});

test("platform pages refuse framing and MIME sniffing", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-security-policy"]).toBe("frame-ancestors 'none'");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
});
