import { describe, expect, it, vi } from "vitest";
import { markerForTicket } from "./draft";
import {
  ESCALATION_EVENTS,
  type EscalationRepository,
  type EscalationTicket,
  escalateTicketToGitHub,
} from "./escalation-service";
import { createMockTrackerFactory } from "./mock";

const MESSAGE = "The projects section becomes blank in Safari dark mode.";

function createFakeRepository(overrides: Partial<EscalationRepository> = {}) {
  const events: string[] = [];
  const repository: EscalationRepository = {
    getIntegration: vi.fn(async () => ({
      installationId: "10",
      repositoryId: "20",
      repositoryOwner: "demo",
      repositoryName: "disposable",
      status: "active",
    })),
    getIssueLink: vi.fn(async () => undefined),
    reserveIssueLink: vi.fn(async () => {}),
    claimIssueCreation: vi.fn(async () => ({
      claimed: true as const,
      previousStatus: "pending",
      marker: markerForTicket("SUP-123", "ticket-1"),
    })),
    confirmIssueLink: vi.fn(async () => {}),
    markIssueStatus: vi.fn(async () => {}),
    recordEvent: vi.fn(async (input: { type: string }) => {
      events.push(input.type);
    }),
    ...overrides,
  };
  return { repository, events };
}

function ticket(overrides: Partial<EscalationTicket> = {}): EscalationTicket {
  return {
    ticketId: "ticket-1",
    projectId: "project-1",
    workspaceId: "workspace-1",
    ticketNumber: 123,
    ticketReference: "SUP-123",
    status: "queued",
    route: "engineering",
    reportedAt: new Date("2026-01-02T03:04:05.000Z"),
    message: MESSAGE,
    categoryHint: "bug",
    classification: {
      type: "bug",
      severity: "medium",
      confidence: 0.94,
      route: "engineering",
      githubIssueRecommended: true,
    },
    override: null,
    ...overrides,
  };
}

describe("escalateTicketToGitHub", () => {
  it("creates one issue with draft content for an eligible ticket", async () => {
    const { repository, events } = createFakeRepository();
    const factory = createMockTrackerFactory();
    const outcome = await escalateTicketToGitHub({
      repository,
      trackers: factory,
      ticket: ticket(),
    });
    expect(outcome.outcome).toBe("created");
    expect(factory.created).toHaveLength(1);
    expect(factory.created[0]?.title).toContain("[SUP-123]");
    expect(factory.created[0]?.body).toContain(
      markerForTicket("SUP-123", "ticket-1"),
    );
    expect(factory.created[0]?.body).not.toContain("ada@example");
    expect(events).toContain(ESCALATION_EVENTS.requested);
    expect(events).toContain(ESCALATION_EVENTS.created);
  });

  it("returns existing linkage without creating", async () => {
    const { repository } = createFakeRepository({
      getIssueLink: async () => ({
        status: "open",
        issueNumber: 7,
        url: "https://github.com/demo/disposable/issues/7",
      }),
    });
    const factory = createMockTrackerFactory();
    const outcome = await escalateTicketToGitHub({
      repository,
      trackers: factory,
      ticket: ticket(),
    });
    expect(outcome).toEqual({
      outcome: "already-linked",
      issue: {
        number: 7,
        url: "https://github.com/demo/disposable/issues/7",
      },
    });
    expect(factory.created).toHaveLength(0);
  });

  it("lets a human decline win over an AI recommendation", async () => {
    const { repository, events } = createFakeRepository();
    const factory = createMockTrackerFactory();
    const outcome = await escalateTicketToGitHub({
      repository,
      trackers: factory,
      ticket: ticket({
        override: { route: null, githubIssueRecommended: false },
      }),
    });
    expect(outcome.outcome).toBe("blocked");
    expect(factory.created).toHaveLength(0);
    expect(events).toContain(ESCALATION_EVENTS.blocked);
  });

  it("blocks privacy-sensitive content without calling GitHub", async () => {
    const { repository, events } = createFakeRepository();
    const factory = createMockTrackerFactory();
    const outcome = await escalateTicketToGitHub({
      repository,
      trackers: factory,
      ticket: ticket({ message: "Bug here, contact ada@example.com" }),
    });
    expect(outcome).toEqual({
      outcome: "blocked",
      code: "GITHUB_PRIVACY_BLOCKED",
      reasons: ["detected email"],
    });
    expect(factory.created).toHaveLength(0);
    expect(events).toContain(ESCALATION_EVENTS.blocked);
  });

  it("rejects ineligible tickets and missing integrations", async () => {
    const { repository } = createFakeRepository({
      getIntegration: async () => undefined,
    });
    expect(
      await escalateTicketToGitHub({
        repository,
        trackers: createMockTrackerFactory(),
        ticket: ticket(),
      }),
    ).toEqual({ outcome: "not-configured" });

    const { repository: repo2 } = createFakeRepository();
    const low = await escalateTicketToGitHub({
      repository: repo2,
      trackers: createMockTrackerFactory(),
      ticket: ticket({
        classification: {
          type: "bug",
          severity: "medium",
          confidence: 0.4,
          route: "engineering",
          githubIssueRecommended: true,
        },
      }),
    });
    expect(low.outcome).toBe("blocked");
  });

  it("marks timeouts unknown without blind retry", async () => {
    const { repository, events } = createFakeRepository();
    const outcome = await escalateTicketToGitHub({
      repository,
      trackers: createMockTrackerFactory([{ kind: "timeout" }]),
      ticket: ticket(),
    });
    expect(outcome).toEqual({
      outcome: "unknown",
      code: "GITHUB_CREATION_UNKNOWN",
    });
    expect(events).toContain(ESCALATION_EVENTS.unknown);
  });

  it("reconciles an ambiguous create into the existing issue", async () => {
    const { repository } = createFakeRepository();
    const outcome = await escalateTicketToGitHub({
      repository,
      trackers: createMockTrackerFactory([{ kind: "ambiguous-then-found" }]),
      ticket: ticket(),
    });
    expect(outcome.outcome).toBe("reconciled");
    if (outcome.outcome === "reconciled") {
      expect(outcome.issue.number).toBe(7);
    }
  });

  it("maps permission failures to retryable states", async () => {
    const { repository, events } = createFakeRepository();
    const outcome = await escalateTicketToGitHub({
      repository,
      trackers: createMockTrackerFactory([{ kind: "permission-denied" }]),
      ticket: ticket(),
    });
    expect(outcome).toEqual({
      outcome: "failed",
      code: "GITHUB_PERMISSION_DENIED",
    });
    expect(events).toContain(ESCALATION_EVENTS.failed);
  });
});
