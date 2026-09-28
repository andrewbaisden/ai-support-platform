import { describe, expect, it } from "vitest";
import { markerForTicket } from "./draft";
import { type PreviewTicket, previewEscalation } from "./preview";

function ticket(overrides: Partial<PreviewTicket> = {}): PreviewTicket {
  return {
    ticketId: "ticket-123",
    ticketReference: "SUP-123",
    status: "queued",
    route: "engineering",
    reportedAt: new Date("2026-01-02T03:04:05.000Z"),
    message: "The export page is blank and shows an error on submit.",
    categoryHint: "bug",
    contact: null,
    classification: {
      type: "bug",
      severity: "medium",
      confidence: 0.94,
      route: "engineering",
      githubIssueRecommended: true,
      source: "model",
    },
    override: null,
    ...overrides,
  };
}

const integration = {
  repositoryOwner: "demo",
  repositoryName: "disposable",
  status: "active",
};

describe("previewEscalation", () => {
  it("builds an eligible preview without side effects", () => {
    const preview = previewEscalation({ ticket: ticket(), integration });
    expect(preview.state).toBe("eligible");
    if (preview.state !== "eligible") throw new Error("unreachable");
    expect(preview.repository).toEqual({ owner: "demo", repo: "disposable" });
    expect(preview.draft.title).toContain("[SUP-123]");
    expect(preview.draft.body).toContain(
      markerForTicket("SUP-123", "ticket-123"),
    );
  });

  it("requires model provenance or an owner recommendation", () => {
    const fixture = ticket({
      classification: {
        type: "bug",
        severity: "medium",
        confidence: 0.94,
        route: "engineering",
        githubIssueRecommended: true,
        source: "fixture",
      },
    });
    expect(previewEscalation({ ticket: fixture, integration })).toEqual({
      state: "blocked",
      code: "GITHUB_NOT_ELIGIBLE",
      reasons: [
        "classification source fixture needs a model result or an owner recommendation",
      ],
    });
    expect(
      previewEscalation({
        ticket: {
          ...fixture,
          override: { route: null, githubIssueRecommended: true },
        },
        integration,
      }).state,
    ).toBe("eligible");
    expect(
      previewEscalation({
        ticket: fixture,
        integration,
        allowFixtureClassifications: true,
      }).state,
    ).toBe("eligible");
  });

  it("reports not-configured, linked, unknown, and blocked states", () => {
    expect(previewEscalation({ ticket: ticket() }).state).toBe(
      "not-configured",
    );
    expect(
      previewEscalation({
        ticket: ticket(),
        integration: { ...integration, status: "disconnected" },
      }).state,
    ).toBe("not-configured");
    expect(
      previewEscalation({
        ticket: ticket(),
        integration,
        link: { status: "open", issueNumber: 7, url: "https://github.com/x" },
      }),
    ).toMatchObject({ state: "already-linked" });
    expect(
      previewEscalation({
        ticket: ticket(),
        integration,
        link: { status: "needs_reconciliation", issueNumber: null, url: null },
      }).state,
    ).toBe("unknown");
    expect(
      previewEscalation({
        ticket: ticket(),
        integration,
        link: { status: "creating", issueNumber: null, url: null },
      }).state,
    ).toBe("in-progress");
    expect(
      previewEscalation({
        ticket: ticket({ message: "Mail ada@example.com" }),
        integration,
      }),
    ).toMatchObject({ state: "blocked", code: "GITHUB_PRIVACY_BLOCKED" });
    expect(
      previewEscalation({
        ticket: ticket({
          message: "Ada Tester here: the export page is blank on submit.",
          contact: { name: "Ada Tester", email: "ada@example.test" },
        }),
        integration,
      }),
    ).toEqual({
      state: "blocked",
      code: "GITHUB_PRIVACY_BLOCKED",
      reasons: ["detected contact-detail"],
    });
    expect(
      previewEscalation({
        ticket: ticket({
          override: { route: null, githubIssueRecommended: false },
        }),
        integration,
      }),
    ).toMatchObject({ state: "blocked", code: "GITHUB_BLOCKED" });
    expect(
      previewEscalation({
        ticket: ticket({ status: "needs_triage" }),
        integration,
      }),
    ).toMatchObject({ state: "blocked", code: "GITHUB_NOT_ELIGIBLE" });
  });
});
