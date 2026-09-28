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

test("password reset stays unavailable until email is configured", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Forgot your password?" }),
  ).toHaveCount(0);
  await page.goto("/forgot-password");
  await expect(page.getByRole("status")).toContainText(
    "Password reset by email is not configured",
  );
  await page.goto("/reset-password");
  await expect(page.getByRole("alert")).toContainText("invalid or has expired");
});
