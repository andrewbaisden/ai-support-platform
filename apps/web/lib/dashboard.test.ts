import { describe, expect, it } from "vitest";
import {
  parseTicketFilters,
  parseTicketReference,
  ticketFilterSearch,
} from "./dashboard-filters";
import { canTransition, transitionEvent } from "./ticket-transitions";

describe("dashboard filters", () => {
  it("parses repeated filter params and drops unknown values", () => {
    const filters = parseTicketFilters({
      status: ["queued", "resolved", "bogus"],
      route: "engineering",
      type: ["bug", "nope"],
      severity: [],
      page: "3",
    });
    expect(filters).toEqual({
      statuses: ["queued", "resolved"],
      routes: ["engineering"],
      types: ["bug"],
      severities: [],
      ticketNumber: undefined,
      page: 3,
    });
  });

  it("defaults the page and parses ticket references", () => {
    expect(parseTicketFilters({ page: "abc" }).page).toBe(1);
    expect(parseTicketFilters({ page: ["2"] }).page).toBe(2);
    expect(parseTicketReference("SUP-42")).toBe(42);
    expect(parseTicketReference("sup-7")).toBe(7);
    expect(parseTicketReference("123")).toBe(123);
    expect(parseTicketReference("SUP-abc")).toBeUndefined();
    expect(parseTicketReference(undefined)).toBeUndefined();
  });

  it("round-trips filters into shareable query strings", () => {
    const search = ticketFilterSearch(
      { statuses: ["queued"], routes: [], types: ["bug"], severities: [] },
      2,
    );
    expect(search).toContain("status=queued");
    expect(search).toContain("type=bug");
    expect(search).toContain("page=2");
    expect(
      ticketFilterSearch(
        { statuses: [], routes: [], types: [], severities: [] },
        1,
      ),
    ).toBe("");
  });
});

describe("ticket transitions", () => {
  it("allows resolve, reopen, release, and quarantine paths", () => {
    expect(canTransition("queued", "resolved")).toBe(true);
    expect(canTransition("needs_triage", "resolved")).toBe(true);
    expect(canTransition("quarantined", "resolved")).toBe(true);
    expect(canTransition("resolved", "queued")).toBe(true);
    expect(canTransition("quarantined", "queued")).toBe(true);
    expect(canTransition("needs_triage", "quarantined")).toBe(true);
    expect(canTransition("queued", "queued")).toBe(true);
  });

  it("refuses escalation states and backward triage", () => {
    expect(canTransition("queued", "escalated")).toBe(false);
    expect(canTransition("queued", "escalation_pending")).toBe(false);
    expect(canTransition("resolved", "escalated")).toBe(false);
    expect(canTransition("queued", "needs_triage")).toBe(false);
    expect(canTransition("resolved", "quarantined")).toBe(false);
  });

  it("names audit events for each transition", () => {
    expect(transitionEvent("queued", "resolved")).toBe("resolved");
    expect(transitionEvent("resolved", "queued")).toBe("reopened");
    expect(transitionEvent("quarantined", "queued")).toBe(
      "released_from_quarantine",
    );
    expect(transitionEvent("queued", "quarantined")).toBe("rerouted");
  });
});
