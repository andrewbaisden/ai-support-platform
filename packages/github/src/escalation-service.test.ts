import { describe, expect, it, vi } from "vitest";
import { markerForTicket } from "./draft";
import { GithubError } from "./errors";
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
    contact: null,
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

  it("holds back a report that repeats the visitor's submitted name", async () => {
    const { repository } = createFakeRepository();
    const factory = createMockTrackerFactory();
    const outcome = await escalateTicketToGitHub({
      repository,
      trackers: factory,
      ticket: ticket({
        message: "Grace Example reporting: the export page is blank.",
        contact: { name: "Grace Example", email: "grace@example.test" },
      }),
    });
    expect(outcome).toEqual({
      outcome: "blocked",
      code: "GITHUB_PRIVACY_BLOCKED",
      reasons: ["detected contact-detail"],
    });
    expect(factory.created).toHaveLength(0);
    expect(repository.reserveIssueLink).not.toHaveBeenCalled();
    expect(
      JSON.stringify(vi.mocked(repository.recordEvent).mock.calls),
    ).not.toContain("Grace");
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

  it.each([
    ["auth-failure", "failed", "GITHUB_AUTH_FAILED", "retry_required"],
    [
      "permission-denied",
      "failed",
      "GITHUB_PERMISSION_DENIED",
      "retry_required",
    ],
    [
      "repository-missing",
      "failed",
      "GITHUB_REPOSITORY_NOT_FOUND",
      "retry_required",
    ],
    ["rate-limited", "failed", "GITHUB_RATE_LIMITED", "retry_required"],
    ["timeout", "unknown", "GITHUB_CREATION_UNKNOWN", "needs_reconciliation"],
    [
      "unavailable",
      "unknown",
      "GITHUB_CREATION_UNKNOWN",
      "needs_reconciliation",
    ],
  ] as const)(
    "maps a %s create failure to a safe %s outcome and %s-style recovery state",
    async (kind, outcome, code, status) => {
      const { repository, events } = createFakeRepository();
      const factory = createMockTrackerFactory([{ kind }]);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const result = await escalateTicketToGitHub({
          repository,
          trackers: factory,
          ticket: ticket(),
        });
        expect(result).toEqual({ outcome, code });
        expect(factory.created).toHaveLength(0);
        expect(repository.confirmIssueLink).not.toHaveBeenCalled();
        expect(repository.markIssueStatus).toHaveBeenCalledWith(
          expect.objectContaining({ status }),
        );
        expect(events).toContain(
          outcome === "failed"
            ? ESCALATION_EVENTS.failed
            : ESCALATION_EVENTS.unknown,
        );
        // Summaries carry only safe codes: no visitor text or mock detail.
        const recorded = JSON.stringify(
          vi.mocked(repository.recordEvent).mock.calls,
        );
        expect(recorded).not.toContain(MESSAGE);
        expect(recorded).not.toMatch(/Mock /);
        expect(log).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
        error.mockRestore();
      }
    },
  );

  it("never creates while resuming an ambiguous attempt that finds no issue", async () => {
    const { repository, events } = createFakeRepository({
      claimIssueCreation: vi.fn(async () => ({
        claimed: true as const,
        previousStatus: "needs_reconciliation",
        marker: markerForTicket("SUP-123", "ticket-1"),
      })),
    });
    const factory = createMockTrackerFactory([{ kind: "success" }]);
    const outcome = await escalateTicketToGitHub({
      repository,
      trackers: factory,
      ticket: ticket(),
    });
    expect(outcome).toEqual({
      outcome: "unknown",
      code: "GITHUB_CREATION_UNKNOWN",
    });
    expect(factory.created).toHaveLength(0);
    expect(repository.markIssueStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "needs_reconciliation" }),
    );
    expect(events).not.toContain(ESCALATION_EVENTS.created);
  });

  it("fails safely when the GitHub App client or repository check fails", async () => {
    const { repository, events } = createFakeRepository();
    const outcome = await escalateTicketToGitHub({
      repository,
      trackers: {
        forInstallation: async () => {
          throw new GithubError("GITHUB_AUTH_FAILED", "bad key material");
        },
      },
      ticket: ticket(),
    });
    expect(outcome).toEqual({ outcome: "failed", code: "GITHUB_AUTH_FAILED" });
    expect(repository.markIssueStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "retry_required" }),
    );
    expect(events).toContain(ESCALATION_EVENTS.failed);
    expect(
      JSON.stringify(vi.mocked(repository.recordEvent).mock.calls),
    ).not.toContain("bad key material");
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
