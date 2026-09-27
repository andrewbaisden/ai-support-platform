import { randomUUID } from "node:crypto";
import type { TicketSubmissionRequest } from "@ai-support-platform/support-contracts";
import { describe, expect, it } from "vitest";
import {
  type IngestionRepository,
  submissionFingerprint,
} from "./support-ingestion";
import { handleTicketOptions, handleTicketPost } from "./support-route";

const PROJECT_KEY = `pk_${"C".repeat(32)}`;
const PROJECT_ID = "20000000-0000-4000-8000-000000000009";
const MESSAGE = "The projects page is blank in Safari dark mode.";

function validInput(
  overrides: Partial<TicketSubmissionRequest> = {},
): TicketSubmissionRequest {
  return {
    projectKey: PROJECT_KEY,
    category: "bug",
    message: MESSAGE,
    submissionId: randomUUID(),
    ...overrides,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    projectKey: PROJECT_KEY,
    category: "bug",
    message: MESSAGE,
    submissionId: randomUUID(),
    ...overrides,
  };
}

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://test/api/v1/support/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function createFakeRepository(
  overrides: Partial<IngestionRepository> = {},
): IngestionRepository & { tickets: Map<string, number> } {
  const tickets = new Map<string, number>();
  let ticketNumber = 41;
  return {
    tickets,
    async getProjectByPublicKey(key: string) {
      if (key !== PROJECT_KEY) return undefined;
      return { id: PROJECT_ID, allowedOrigins: ["http://127.0.0.1:3001"] };
    },
    async getSubmissionForRetry(projectId, submissionKey, fingerprint) {
      void projectId;
      void fingerprint;
      const ticketNumberForKey = tickets.get(submissionKey);
      return ticketNumberForKey === undefined
        ? undefined
        : { ticketNumber: ticketNumberForKey };
    },
    async consumeSubmissionRateLimit() {
      return true;
    },
    async createSubmission(input) {
      const existing = tickets.get(input.submissionKey);
      if (existing !== undefined) return { ticketNumber: existing };
      ticketNumber += 1;
      tickets.set(input.submissionKey, ticketNumber);
      return { ticketNumber };
    },
    ...overrides,
  };
}

describe("public ticket ingestion contract", () => {
  it.each(["question", "bug", "feature_request"])(
    "accepts a valid %s submission",
    async (category) => {
      const response = await handleTicketPost(
        postRequest(validBody({ category })),
        createFakeRepository(),
      );
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        ticketReference: expect.stringMatching(/^SUP-[1-9][0-9]*$/),
        status: "received",
      });
    },
  );

  it("returns the same ticket on idempotent retry", async () => {
    const repository = createFakeRepository();
    const body = validBody();
    const first = await handleTicketPost(postRequest(body), repository);
    const second = await handleTicketPost(postRequest(body), repository);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    expect(repository.tickets.size).toBe(1);
  });

  it("rejects missing message, invalid email, long message, and invalid category", async () => {
    const repository = createFakeRepository();
    const cases = [
      validBody({ message: undefined }),
      validBody({ contact: { email: "not-an-email" } }),
      validBody({ message: `x`.repeat(10_001) }),
      validBody({ category: "billing" }),
      validBody({ submissionId: "not-a-uuid" }),
      { unexpected: true },
    ];
    for (const body of cases) {
      const response = await handleTicketPost(postRequest(body), repository);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { code: "INVALID_REQUEST" },
      });
    }
    expect(repository.tickets.size).toBe(0);
  });

  it("maps an unknown project to a safe 404 without internal detail", async () => {
    const response = await handleTicketPost(
      postRequest(validBody({ projectKey: `pk_${"Z".repeat(32)}` })),
      createFakeRepository(),
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "PROJECT_NOT_FOUND" },
    });
  });

  it("rejects a disallowed browser origin with 403", async () => {
    const response = await handleTicketPost(
      postRequest(validBody(), { Origin: "https://evil.example" }),
      createFakeRepository(),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "ORIGIN_NOT_ALLOWED" },
    });
  });

  it("allows requests without an Origin header for non-browser clients", async () => {
    const response = await handleTicketPost(
      postRequest(validBody()),
      createFakeRepository(),
    );
    expect(response.status).toBe(201);
  });

  it("returns 409 when a submission key is reused with different content", async () => {
    const repository = createFakeRepository({
      async getSubmissionForRetry() {
        const error = new Error("Submission key was reused");
        error.name = "SubmissionConflictError";
        throw error;
      },
    });
    const response = await handleTicketPost(
      postRequest(validBody()),
      repository,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "SUBMISSION_CONFLICT" },
    });
  });

  it("returns 429 when the project rate limit is exhausted", async () => {
    const response = await handleTicketPost(
      postRequest(validBody()),
      createFakeRepository({
        async consumeSubmissionRateLimit() {
          return false;
        },
      }),
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: { code: "RATE_LIMITED" } });
  });

  it("rejects oversized and non-JSON bodies", async () => {
    const repository = createFakeRepository();
    const tooLarge = await handleTicketPost(
      postRequest(validBody({ message: "x".repeat(20_000) })),
      repository,
    );
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({
      error: { code: "BODY_TOO_LARGE" },
    });

    const wrongType = await handleTicketPost(
      new Request("http://test/api/v1/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "hello",
      }),
      repository,
    );
    expect(wrongType.status).toBe(415);

    const malformed = await handleTicketPost(
      postRequest("{not json"),
      repository,
    );
    expect(malformed.status).toBe(400);
  });

  it("does not leak internal failure detail on persistence errors", async () => {
    const response = await handleTicketPost(
      postRequest(validBody()),
      createFakeRepository({
        async getSubmissionForRetry() {
          return undefined;
        },
        async createSubmission() {
          throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "SUBMISSION_FAILED" },
    });
  });

  it("answers preflight only for the resolved project origin", async () => {
    const repository = createFakeRepository();
    const allowed = await handleTicketOptions(
      new Request(
        `http://test/api/v1/support/tickets?projectKey=${PROJECT_KEY}`,
        { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:3001" } },
      ),
      repository,
    );
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://127.0.0.1:3001",
    );

    const denied = await handleTicketOptions(
      new Request(
        `http://test/api/v1/support/tickets?projectKey=${PROJECT_KEY}`,
        { method: "OPTIONS", headers: { Origin: "https://evil.example" } },
      ),
      repository,
    );
    expect(denied.status).toBe(403);
  });
});

describe("submission fingerprint", () => {
  it("is deterministic, content-bound, and opaque", () => {
    const input = validInput();
    const first = submissionFingerprint(input);
    expect(submissionFingerprint({ ...input })).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain(MESSAGE);
    expect(submissionFingerprint({ ...input, category: "question" })).not.toBe(
      first,
    );
  });
});
