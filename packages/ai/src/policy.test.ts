import { describe, expect, it } from "vitest";
import { GITHUB_ESCALATION_CONFIDENCE_THRESHOLD } from "./config";
import { evaluateGitHubEscalation, routeForType } from "./policy";

describe("triage routing policy", () => {
  it("maps each ticket type to its owning queue", () => {
    expect(routeForType("question")).toBe("support");
    expect(routeForType("bug")).toBe("engineering");
    expect(routeForType("feature_request")).toBe("product");
    expect(routeForType("spam")).toBe("ignore");
    expect(routeForType("account")).toBe("support");
    expect(routeForType("billing")).toBe("support");
    expect(routeForType("feedback")).toBe("support");
    expect(routeForType("other")).toBe("support");
  });

  it("keeps the escalation threshold conservative and documented", () => {
    expect(GITHUB_ESCALATION_CONFIDENCE_THRESHOLD).toBe(0.9);
  });

  it("marks a confident engineering bug eligible", () => {
    const result = evaluateGitHubEscalation({
      type: "bug",
      route: "engineering",
      confidence: 0.95,
    });
    expect(result).toEqual({ eligible: true, reasons: [] });
  });

  it("withholds eligibility for non-bugs, wrong routes, and low confidence", () => {
    expect(
      evaluateGitHubEscalation({
        type: "question",
        route: "support",
        confidence: 0.99,
      }).eligible,
    ).toBe(false);
    expect(
      evaluateGitHubEscalation({
        type: "spam",
        route: "ignore",
        confidence: 0.99,
      }).eligible,
    ).toBe(false);
    const below = evaluateGitHubEscalation({
      type: "bug",
      route: "engineering",
      confidence: 0.89,
    });
    expect(below.eligible).toBe(false);
    expect(below.reasons.join(" ")).toContain("0.9");
    const uncertain = evaluateGitHubEscalation({
      type: "bug",
      route: "engineering",
      confidence: 0.4,
    });
    expect(uncertain.eligible).toBe(false);
    expect(uncertain.reasons.length).toBeGreaterThan(1);
  });
});
