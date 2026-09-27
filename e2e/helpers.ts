import { expect, type Page } from "@playwright/test";

/**
 * Click a dashboard action button until its result settles. Clicks landing
 * before dev chunk hydration never reach React, so a single click is flaky
 * under parallel load: attempts are short so retries converge quickly once
 * the island hydrates. Retries are safe for idempotent or
 * reconcile-guarded mutations (resolve, GitHub create); re-triage retries
 * may append a duplicate history row, which the flows tolerate.
 */
export async function clickUntilSettled(
  page: Page,
  buttonName: string | RegExp,
  settled: RegExp,
  attempts = 6,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await page.getByRole("button", { name: buttonName }).click();
    const done = await page
      .getByText(settled)
      .first()
      .waitFor({ timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (done) return;
  }
  throw new Error(`Action ${buttonName} never settled`);
}

/**
 * Resolve a ticket until the resolved state is visible. Re-clicks are safe:
 * resolving an already-resolved ticket is a validated no-op.
 */
export async function clickResolveUntilDone(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (
      await page
        .getByText("Ticket moved to resolved.")
        .waitFor({ timeout: 3000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }
    if (
      (await page.getByRole("button", { name: "Mark resolved" }).count()) ===
        0 &&
      (await page.getByRole("button", { name: "Reopen ticket" }).count()) > 0
    ) {
      return;
    }
    await page.getByRole("button", { name: "Mark resolved" }).click();
  }
  await expect(page.getByText("Ticket moved to resolved.")).toBeVisible();
}

/**
 * Run GitHub creation until the linked issue is visible. A slow first
 * attempt may succeed after its wait expires; the retry then converges via
 * the already-linked state instead of duplicating, so absence of the button
 * alongside the linked issue also counts as success.
 */
export async function clickCreateUntilSuccess(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (
      await page
        .getByText(/Issue created \(#\d+\)/)
        .waitFor({ timeout: 3000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }
    if (
      (await page
        .getByRole("button", { name: "Create GitHub issue" })
        .count()) === 0 &&
      (await page.getByText("Linked issue").count()) > 0
    ) {
      return;
    }
    await page.getByRole("button", { name: "Create GitHub issue" }).click();
  }
  await expect(page.getByText(/Issue created \(#\d+\)/)).toBeVisible();
}
