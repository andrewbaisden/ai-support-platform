import { describe, expect, it, vi } from "vitest";
import { AiError } from "./errors";
import { FixtureTicketClassifier } from "./fixture-classifier";
import {
  type TriageRepository,
  type TriageTicket,
  triageTicket,
} from "./triage-service";

function createFakeRepository() {
  const classifications: Array<{
    type: string;
    route: string;
    confidence: number;
    githubIssueRecommended: boolean;
    reason: string | null;
  }> = [];
  const events: string[] = [];
  const repository: TriageRepository = {
    getCurrentClassification: vi.fn(async () => {
      const [current] = classifications.slice(-1);
      return current
        ? { type: current.type as "bug", route: current.route as "engineering" }
        : undefined;
    }),
    appendClassification: vi.fn(async (input) => {
      classifications.push({
        type: input.type,
        route: input.route,
        confidence: input.confidence,
        githubIssueRecommended: input.githubIssueRecommended,
        reason: input.reason,
      });
      return { id: `classification-${classifications.length}` };
    }),
    recordTicketEvent: vi.fn(async (input) => {
      events.push(input.type);
    }),
  };
  return { repository, classifications, events };
}

function ticket(overrides: Partial<TriageTicket> = {}): TriageTicket {
  return {
    ticketId: "ticket-1",
    projectId: "project-1",
    workspaceId: "workspace-1",
    status: "needs_triage",
    message: "The projects section becomes blank in Safari dark mode.",
    categoryHint: "bug",
    ...overrides,
  };
}

describe("triageTicket", () => {
  it("persists a validated classification with policy route and eligibility", async () => {
    const { repository, classifications } = createFakeRepository();
    const outcome = await triageTicket(
      repository,
      new FixtureTicketClassifier(),
      ticket(),
    );
    expect(outcome).toMatchObject({
      outcome: "classified",
      type: "bug",
      route: "engineering",
      githubEligible: true,
    });
    expect(classifications).toHaveLength(1);
    expect(classifications[0]).toMatchObject({
      route: "engineering",
      githubIssueRecommended: true,
    });
    expect(repository.recordTicketEvent).not.toHaveBeenCalled();
  });

  it("preserves the hint while recording a disagreeing classification", async () => {
    const { repository, classifications } = createFakeRepository();
    const outcome = await triageTicket(
      repository,
      new FixtureTicketClassifier(),
      ticket({
        message: "How did you build the animated background?",
        categoryHint: "bug",
      }),
    );
    expect(outcome).toMatchObject({ outcome: "classified", type: "question" });
    expect(classifications).toHaveLength(1);
  });

  it("skips tickets that are already triaged without calling the classifier", async () => {
    const { repository } = createFakeRepository();
    const classifier = {
      classify: vi.fn(async () => {
        throw new Error("must not be called");
      }),
    };
    const done = await triageTicket(
      repository,
      classifier,
      ticket({ status: "queued" }),
    );
    expect(done.outcome).toBe("already-triaged");
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it("keeps failed tickets retryable with a failure event", async () => {
    const { repository, classifications, events } = createFakeRepository();
    const outcome = await triageTicket(
      repository,
      {
        classify: async () => {
          throw new AiError("AI_TIMEOUT", "timed out");
        },
      },
      ticket(),
    );
    expect(outcome).toEqual({ outcome: "failed", code: "AI_TIMEOUT" });
    expect(classifications).toHaveLength(0);
    expect(events).toEqual(["triage_failed"]);
  });

  it("converges concurrent attempts without broken state", async () => {
    const { repository, classifications } = createFakeRepository();
    const classifier = new FixtureTicketClassifier();
    const [first, second] = await Promise.all([
      triageTicket(repository, classifier, ticket()),
      triageTicket(repository, classifier, ticket()),
    ]);
    expect([first.outcome, second.outcome]).toContain("classified");
    expect(classifications.length).toBeGreaterThanOrEqual(1);
    expect(
      classifications.every((entry) => entry.route === "engineering"),
    ).toBe(true);
  });
});
