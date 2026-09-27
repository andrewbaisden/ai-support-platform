import { describe, expect, it } from "vitest";
import { buildIssueDraft, labelsFor, markerForTicket } from "./draft";

const base = {
  ticketId: "ticket-123",
  ticketReference: "SUP-123",
  categoryHint: "bug",
  message: "The projects section becomes blank in Safari dark mode.",
  type: "bug",
  severity: "medium" as const,
  confidence: 0.94,
  route: "engineering",
  reportedAt: new Date("2026-01-02T03:04:05.000Z"),
};

describe("issue draft", () => {
  it("builds a bounded deterministic title and body with marker", () => {
    const draft = buildIssueDraft(base);
    expect(draft.title).toBe(
      "[SUP-123] Reported bug: The projects section becomes blank in Safari dark mode.",
    );
    expect(draft.title.length).toBeLessThanOrEqual(200);
    expect(draft.labels).toEqual(["bug"]);
    expect(draft.marker).toBe(
      markerForTicket(base.ticketReference, base.ticketId),
    );
    expect(draft.body).toContain(draft.marker);
    expect(draft.body).toContain("SUP-123");
    expect(draft.body).toContain(base.message);
    expect(draft.body).toContain(
      "model score 0.94 — not a calibrated probability",
    );
    expect(draft.body).not.toMatch(/ada@example|password|SUP-123-\w/);
  });

  it("falls back safely for empty or oversized content", () => {
    expect(buildIssueDraft({ ...base, message: "   \n  " }).title).toBe(
      "[SUP-123] Reported bug",
    );
    const long = buildIssueDraft({ ...base, message: `x`.repeat(5000) });
    expect(long.body).toContain("[truncated]");
    expect(long.body.length).toBeLessThan(6000);
  });

  it("renders visitor Markdown as inert code text", () => {
    const report =
      "@operator ![pixel](https://attacker.example/pixel)\n```\ncode";
    const draft = buildIssueDraft({ ...base, message: report });
    expect(draft.body).toContain(`\n\`\`\`\`\n${report}\n\`\`\`\`\n`);
  });

  it("maps severity to the label allowlist only", () => {
    expect(labelsFor("low")).toEqual(["bug"]);
    expect(labelsFor("medium")).toEqual(["bug"]);
    expect(labelsFor("high")).toEqual(["bug", "severity:high"]);
    expect(labelsFor("critical")).toEqual(["bug", "severity:critical"]);
  });

  it("keeps markers stable and reference-scoped", () => {
    expect(markerForTicket("SUP-123", "a")).toBe(
      markerForTicket("SUP-123", "a"),
    );
    expect(markerForTicket("SUP-123", "a")).not.toBe(
      markerForTicket("SUP-123", "b"),
    );
    expect(markerForTicket("SUP-123", "a")).not.toBe(
      markerForTicket("SUP-124", "a"),
    );
  });
});
