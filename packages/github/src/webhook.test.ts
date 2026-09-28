import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  issuesWebhookSchema,
  processGitHubWebhook,
  signWebhookPayload,
  verifyWebhookSignature,
  type WebhookLink,
  type WebhookRepository,
} from "./index";

const secret = "test-secret";
const body = Buffer.from('{"action":"closed", "issue":{"id":1}}', "utf8");

function fixtureLink(overrides: Partial<WebhookLink> = {}): WebhookLink {
  return {
    ticketId: randomUUID(),
    projectId: randomUUID(),
    workspaceId: randomUUID(),
    issueNumber: 4,
    installationId: "10",
    integrationStatus: "active",
    linkStatus: "open",
    ticketStatus: "queued",
    ticketRoute: "engineering",
    ...overrides,
  };
}

function fakeRepository(link: WebhookLink | undefined) {
  const events: string[] = [];
  const statuses: string[] = [];
  let issueState = link?.linkStatus;
  let remoteUpdatedAt = link?.remoteUpdatedAt;
  let ticketStatus = link?.ticketStatus;
  let latestStatusEvent = link?.latestStatusEvent;
  const seen = new Set<string>();
  const repository: WebhookRepository = {
    withDelivery: async (delivery, callback) => {
      if (seen.has(delivery.deliveryId)) return { outcome: "duplicate" };
      const result = await callback({
        findLink: async () =>
          link
            ? {
                ...link,
                linkStatus: issueState ?? link.linkStatus,
                ticketStatus: ticketStatus ?? link.ticketStatus,
                ...(latestStatusEvent ? { latestStatusEvent } : {}),
                ...(remoteUpdatedAt ? { remoteUpdatedAt } : {}),
              }
            : undefined,
        setIssueState: async (_link, state, updatedAt) => {
          issueState = state;
          if (updatedAt) remoteUpdatedAt = updatedAt;
        },
        setTicketStatus: async (_link, status, event) => {
          ticketStatus = status;
          latestStatusEvent = event;
          statuses.push(status);
          events.push(event);
        },
        recordEvent: async (_link, event) => {
          events.push(event);
        },
      });
      seen.add(delivery.deliveryId);
      return result;
    },
  };
  return {
    repository,
    events,
    statuses,
    get issueState() {
      return issueState;
    },
    get remoteUpdatedAt() {
      return remoteUpdatedAt;
    },
  };
}

const issue = {
  repositoryId: "20",
  githubIssueId: "30",
  issueNumber: 4,
  issueState: "closed" as const,
};
const delivery = () => ({
  deliveryId: randomUUID(),
  eventType: "issues",
  action: "closed",
  repositoryId: "20",
  githubIssueId: "30",
  installationId: "10",
});

describe("GitHub webhook boundary", () => {
  it("authenticates exact bytes and rejects missing, malformed, and changed signatures", () => {
    const signature = signWebhookPayload(secret, body);
    expect(
      verifyWebhookSignature({
        secret,
        rawBody: body,
        signatureHeader: signature,
      }),
    ).toBe(true);
    expect(
      verifyWebhookSignature({
        secret,
        rawBody: Buffer.from(`${body} `),
        signatureHeader: signature,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ secret, rawBody: body, signatureHeader: null }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        secret,
        rawBody: body,
        signatureHeader: "sha256=bad",
      }),
    ).toBe(false);
  });

  it("validates the provider subset without accepting malformed identity", () => {
    const valid = {
      action: "closed",
      issue: { id: 30, number: 4, state: "closed" },
      repository: { id: 20, name: "repo", owner: { login: "owner" } },
      installation: { id: 10 },
    };
    expect(issuesWebhookSchema.safeParse(valid).success).toBe(true);
    expect(
      issuesWebhookSchema.safeParse({
        ...valid,
        repository: { ...valid.repository, id: "20" },
      }).success,
    ).toBe(false);
  });

  it("resolves once and ignores duplicate semantic close", async () => {
    const fake = fakeRepository(fixtureLink());
    const first = delivery();
    expect(
      (
        await processGitHubWebhook(fake.repository, {
          delivery: first,
          action: "closed",
          issue,
          installationId: "10",
        })
      ).outcome,
    ).toBe("processed");
    expect(
      (
        await processGitHubWebhook(fake.repository, {
          delivery: first,
          action: "closed",
          issue,
          installationId: "10",
        })
      ).outcome,
    ).toBe("duplicate");
    await processGitHubWebhook(fake.repository, {
      delivery: delivery(),
      action: "closed",
      issue,
      installationId: "10",
    });
    expect(fake.events).toEqual([
      "github_issue_closed",
      "ticket_resolved_from_github",
    ]);
    expect(fake.statuses).toEqual(["resolved"]);
  });

  it("ignores a delayed older event instead of rolling state back", async () => {
    const github = fakeRepository(fixtureLink());
    const send = (action: "closed" | "reopened", updatedAt: string) =>
      processGitHubWebhook(github.repository, {
        delivery: delivery(),
        action,
        installationId: "10",
        issue: {
          ...issue,
          issueState: action === "closed" ? "closed" : "open",
          updatedAt,
        },
      });
    expect(await send("closed", "2026-09-28T10:00:05Z")).toEqual({
      outcome: "processed",
      detail: "closed",
    });
    // A reopen from before that close arrives late: stale, no mutation.
    expect(await send("reopened", "2026-09-28T10:00:01Z")).toEqual({
      outcome: "ignored",
      reason: "stale_event",
    });
    expect(github.issueState).toBe("closed");
    expect(github.statuses).toEqual(["resolved"]);
    // GitHub timestamps have one-second precision: an equal time cannot be
    // ordered, so arrival order wins.
    expect(await send("reopened", "2026-09-28T10:00:05Z")).toMatchObject({
      detail: "reopened",
    });
    // A newer event for the current state advances the watermark only.
    expect(await send("reopened", "2026-09-28T10:00:09Z")).toEqual({
      outcome: "processed",
      detail: "already_current",
    });
    expect(github.remoteUpdatedAt).toBe("2026-09-28T10:00:09Z");
    expect(await send("closed", "2026-09-28T10:00:07Z")).toEqual({
      outcome: "ignored",
      reason: "stale_event",
    });
    expect(github.issueState).toBe("open");
    expect(github.statuses).toEqual(["resolved", "queued"]);
  });

  it("reopens only GitHub-resolved tickets and preserves manual resolutions", async () => {
    const reopened = { ...issue, issueState: "open" as const };
    const github = fakeRepository(
      fixtureLink({
        linkStatus: "closed",
        ticketStatus: "resolved",
        latestStatusEvent: "ticket_resolved_from_github",
      }),
    );
    await processGitHubWebhook(github.repository, {
      delivery: delivery(),
      action: "reopened",
      issue: reopened,
      installationId: "10",
    });
    expect(github.statuses).toEqual(["queued"]);
    const manual = fakeRepository(
      fixtureLink({
        linkStatus: "closed",
        ticketStatus: "resolved",
        latestStatusEvent: "resolved",
      }),
    );
    await processGitHubWebhook(manual.repository, {
      delivery: delivery(),
      action: "reopened",
      issue: reopened,
      installationId: "10",
    });
    expect(manual.statuses).toEqual([]);
  });

  it("does not mutate wrong installation, unknown issue, or nonengineering ticket", async () => {
    const mismatch = fakeRepository(fixtureLink());
    const result = await processGitHubWebhook(mismatch.repository, {
      delivery: delivery(),
      action: "closed",
      issue,
      installationId: "99",
    });
    expect(result.outcome).toBe("ignored");
    expect(mismatch.events).toEqual([]);
    const unknown = fakeRepository(undefined);
    expect(
      (
        await processGitHubWebhook(unknown.repository, {
          delivery: delivery(),
          action: "closed",
          issue,
          installationId: "10",
        })
      ).outcome,
    ).toBe("ignored");
    const support = fakeRepository(fixtureLink({ ticketRoute: "support" }));
    await processGitHubWebhook(support.repository, {
      delivery: delivery(),
      action: "closed",
      issue,
      installationId: "10",
    });
    expect(support.statuses).toEqual([]);
  });

  it("acknowledges ping and unsupported actions without link lookup or changes", async () => {
    const fake = fakeRepository(fixtureLink());
    expect(
      (
        await processGitHubWebhook(fake.repository, {
          delivery: { deliveryId: randomUUID(), eventType: "ping" },
          action: "ping",
        })
      ).outcome,
    ).toBe("processed");
    expect(
      (
        await processGitHubWebhook(fake.repository, {
          delivery: {
            deliveryId: randomUUID(),
            eventType: "issues",
            action: "edited",
          },
          action: "ignored",
          ignoredReason: "unsupported_action",
        })
      ).outcome,
    ).toBe("ignored");
    expect(fake.events).toEqual([]);
  });
});
