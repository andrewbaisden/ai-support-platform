import { describe, expect, it } from "vitest";
import { classificationInputSchema } from "./classifier";
import { runEvaluation } from "./evaluate";
import { FixtureTicketClassifier } from "./fixture-classifier";

const classifier = new FixtureTicketClassifier();

describe("fixture classifier", () => {
  it("never accepts contact details in its input", () => {
    const parsed = classificationInputSchema.parse({
      message: "What technologies did you use to build this website?",
      email: "ada@example.com",
      name: "Ada",
    });
    expect(parsed).not.toHaveProperty("email");
    expect(parsed).not.toHaveProperty("name");
  });

  it("treats the visitor hint as non-authoritative", async () => {
    const result = await classifier.classify({
      message: "How did you build the animated background?",
      categoryHint: "bug",
    });
    expect(result.type).toBe("question");
    expect(result.provider).toBe("fixture");
  });

  it("classifies the core fixtures deterministically", async () => {
    await expect(
      classifier.classify({
        message: "The projects section becomes blank in Safari dark mode.",
      }),
    ).resolves.toMatchObject({ type: "bug", severity: "high" });
    await expect(
      classifier.classify({
        message:
          "Submitting the payment form exposes another customer's billing information.",
      }),
    ).resolves.toMatchObject({ type: "bug", severity: "critical" });
    await expect(
      classifier.classify({ message: "The contact section is weird." }),
    ).resolves.toMatchObject({ type: "other" });
  });
});

describe("fixture evaluation", () => {
  it("passes the full labeled dataset with the mock classifier", async () => {
    const summary = await runEvaluation(new FixtureTicketClassifier());
    expect(summary.passed).toBe(summary.total);
    expect(summary.total).toBeGreaterThanOrEqual(7);
  });

  it("reports mismatches instead of throwing for a wrong classifier", async () => {
    const summary = await runEvaluation({
      classify: async () => ({
        type: "spam" as const,
        severity: "low" as const,
        confidence: 0.5,
        provider: "broken",
        model: "broken-v1",
      }),
    });
    expect(summary.passed).toBeLessThan(summary.total);
    expect(
      summary.results.find((result) => result.name === "bug")?.mismatches,
    ).not.toHaveLength(0);
  });
});
