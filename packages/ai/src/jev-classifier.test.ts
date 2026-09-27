// @vitest-environment node
// The Jev adapter is server-only: the official SDK refuses browser runtimes.
import type { Fetch } from "@typesafe-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AiError } from "./errors";
import { JevTicketClassifier } from "./jev-classifier";

function systemOneResponse(overrides: {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  severity?: string;
  model?: string;
}) {
  const choice = overrides.choice ?? "bug";
  return {
    model: overrides.model ?? "jev-test",
    answers: {
      ticket_type: {
        type: "choice",
        choice,
        confidence: overrides.confidence ?? 0.99,
        probabilities: overrides.probabilities ?? { [choice]: 0.94 },
      },
      severity: {
        type: "choice",
        choice: overrides.severity ?? "high",
        confidence: 0.9,
        probabilities: { [overrides.severity ?? "high"]: 0.9 },
      },
    },
    usage: { input_tokens: 10, output_tokens: 2 },
  };
}

function stubFetch(body: unknown, status = 200): Fetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
}

const input = {
  message: "The projects section becomes blank in Safari dark mode.",
  categoryHint: "bug" as const,
};

describe("JevTicketClassifier", () => {
  it("normalizes confidence from the selected label probability", async () => {
    const classifier = new JevTicketClassifier({
      apiKey: "test-key",
      fetchImpl: stubFetch(systemOneResponse({})),
    });
    const result = await classifier.classify(input);
    expect(result).toMatchObject({
      type: "bug",
      severity: "high",
      confidence: 0.94,
      provider: "jev",
      model: "jev-test",
    });
  });

  it("rejects labels outside the allowed sets", async () => {
    const classifier = new JevTicketClassifier({
      apiKey: "test-key",
      fetchImpl: stubFetch(systemOneResponse({ choice: "teleport" })),
    });
    await expect(classifier.classify(input)).rejects.toMatchObject({
      code: "AI_SCHEMA_VALIDATION_FAILED",
    });
  });

  it("rejects a missing selected-label probability", async () => {
    const classifier = new JevTicketClassifier({
      apiKey: "test-key",
      fetchImpl: stubFetch(
        systemOneResponse({ probabilities: { question: 0.5 } }),
      ),
    });
    await expect(classifier.classify(input)).rejects.toMatchObject({
      code: "AI_SCHEMA_VALIDATION_FAILED",
    });
  });

  it("maps timeouts, auth failures, and outages without leaking detail", async () => {
    const hanging: Fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    const timeoutClassifier = new JevTicketClassifier({
      apiKey: "test-key",
      timeoutMs: 50,
      fetchImpl: hanging,
    });
    const timeout = await timeoutClassifier
      .classify(input)
      .catch((error: unknown) => error);
    expect(timeout).toBeInstanceOf(AiError);
    expect((timeout as AiError).code).toBe("AI_TIMEOUT");

    const authClassifier = new JevTicketClassifier({
      apiKey: "bad-key",
      fetchImpl: stubFetch({ error: "unauthorized" }, 401),
    });
    await expect(authClassifier.classify(input)).rejects.toMatchObject({
      code: "AI_MISCONFIGURED",
    });

    const outageClassifier = new JevTicketClassifier({
      apiKey: "test-key",
      fetchImpl: stubFetch({ error: "down" }, 500),
    });
    await expect(outageClassifier.classify(input)).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
  });

  it("requires an API key without touching the network", () => {
    const fetchImpl = vi.fn();
    expect(
      () => new JevTicketClassifier({ apiKey: "", fetchImpl }),
    ).toThrowError(AiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends only message and hint in the request state", async () => {
    const fetchImpl = stubFetch(systemOneResponse({}));
    const classifier = new JevTicketClassifier({
      apiKey: "test-key",
      fetchImpl,
    });
    await classifier.classify(input);
    const body = JSON.parse(
      String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.body),
    );
    expect(Object.keys(body)).toContain("state");
    expect(JSON.stringify(body)).not.toMatch(/ada@example|visitor_email/i);
    expect(body.state).toEqual({
      message: input.message,
      category_hint: "bug",
    });
  });
});
