import { createHash, createHmac, randomUUID } from "node:crypto";
import { type APIRequestContext, expect, type Page } from "@playwright/test";
import { DEMO, E2E_OWNER, E2E_WEBHOOK_SECRET, PLATFORM } from "./e2e-env";

export { DEMO, PLATFORM };

/** Seeded mock escalation target for the Portfolio Demo project. */
export const MOCK_REPOSITORY = {
  id: 999,
  installationId: 999,
  owner: "example",
  name: "disposable",
};

export async function login(page: Page) {
  await page.goto(`${PLATFORM}/login`);
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
}

export async function openTicket(page: Page, reference: string) {
  await page
    .locator("li", { hasText: "Portfolio Demo" })
    .getByRole("link", { name: "Open tickets" })
    .click();
  await page.getByLabel("Reference").fill(reference);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("link", { name: reference }).click();
  await page.waitForLoadState("networkidle");
}

/**
 * Remote identity the mock tracker assigns to a ticket: derived from the
 * opaque marker exactly as `packages/github/src/mock.ts` does.
 */
export function mockIssueFor(reference: string, ticketId: string) {
  const nonce = createHash("sha256")
    .update(ticketId)
    .digest("hex")
    .slice(0, 32);
  const marker = `<!-- ai-support-ticket:${reference}:${nonce} -->`;
  let hash = 0x811c9dc5;
  for (const char of `${MOCK_REPOSITORY.owner}/${MOCK_REPOSITORY.name}/${marker}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return {
    id: 100000 + (Math.abs(hash) % 800000),
    number: 1 + (Math.abs(hash) % 4999),
    marker,
  };
}

export function issuesPayload(
  action: "closed" | "reopened",
  issue: { id: number; number: number },
  overrides: { repositoryId?: number; installationId?: number } = {},
) {
  return JSON.stringify({
    action,
    issue: {
      id: issue.id,
      number: issue.number,
      state: action === "closed" ? "closed" : "open",
    },
    repository: {
      id: overrides.repositoryId ?? MOCK_REPOSITORY.id,
      name: MOCK_REPOSITORY.name,
      owner: { login: MOCK_REPOSITORY.owner },
    },
    installation: {
      id: overrides.installationId ?? MOCK_REPOSITORY.installationId,
    },
  });
}

export function signature(raw: string, secret = E2E_WEBHOOK_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

/** POST raw bytes to the real webhook route, signed like GitHub unless overridden. */
export function deliverWebhook(
  request: APIRequestContext,
  raw: string,
  headers: Record<string, string | undefined> = {},
) {
  const merged: Record<string, string | undefined> = {
    "Content-Type": "application/json",
    "X-GitHub-Delivery": randomUUID(),
    "X-GitHub-Event": "issues",
    "X-Hub-Signature-256": signature(raw),
    ...headers,
  };
  return request.post(`${PLATFORM}/api/webhooks/github`, {
    // A Buffer is sent byte-for-byte; a string body that is not valid JSON
    // would be re-serialized by Playwright and no longer match its signature.
    data: Buffer.from(raw),
    headers: Object.fromEntries(
      Object.entries(merged).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  });
}

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
