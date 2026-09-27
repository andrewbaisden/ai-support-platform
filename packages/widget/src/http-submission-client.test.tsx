import { describe, expect, it, vi } from "vitest";
import {
  HttpSubmissionError,
  HttpSupportSubmissionClient,
} from "./http-submission-client";

const PROJECT_KEY = `pk_${"D".repeat(32)}`;

function clientWithFetch(
  fetchImpl: typeof fetch,
  apiBaseUrl = "https://api.support-platform.example",
) {
  return new HttpSupportSubmissionClient({ apiBaseUrl, fetchImpl });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const input = {
  projectKey: PROJECT_KEY,
  category: "bug" as const,
  message: "The projects page is blank in Safari dark mode.",
  name: "Ada",
  email: "ada@example.com",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
};

describe("HttpSupportSubmissionClient", () => {
  it("serializes the contract body and returns the ticket reference", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ticketReference: "SUP-42", status: "received" }, 201),
    ) as unknown as typeof fetch;
    const client = clientWithFetch(fetchImpl);

    const result = await client.submit(input);

    expect(result).toEqual({ reference: "SUP-42" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe(
      `https://api.support-platform.example/api/v1/support/tickets?projectKey=${PROJECT_KEY}`,
    );
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(String(init.body))).toEqual({
      projectKey: PROJECT_KEY,
      category: "bug",
      message: input.message,
      contact: { name: "Ada", email: "ada@example.com" },
      submissionId: input.idempotencyKey,
    });
  });

  it("omits empty contact details and maps public error codes", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: "RATE_LIMITED" } }, 429),
    ) as unknown as typeof fetch;
    const client = clientWithFetch(fetchImpl);

    const error = await client
      .submit({ ...input, name: undefined, email: undefined })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(HttpSubmissionError);
    expect((error as HttpSubmissionError).code).toBe("RATE_LIMITED");
    const [, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).not.toHaveProperty("contact");
  });

  it("maps timeouts, network failures, and malformed responses safely", async () => {
    const timeoutError = Object.assign(new Error("timed out"), {
      name: "TimeoutError",
    });
    const timeoutFetch = vi.fn(async () => {
      throw timeoutError;
    }) as unknown as typeof fetch;
    await expect(
      clientWithFetch(timeoutFetch).submit(input),
    ).rejects.toMatchObject({
      code: "TIMEOUT",
    });

    const networkFetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(
      clientWithFetch(networkFetch).submit(input),
    ).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });

    const invalidFetch = vi.fn(async () =>
      jsonResponse({ ticketReference: "not-a-reference" }, 201),
    ) as unknown as typeof fetch;
    await expect(
      clientWithFetch(invalidFetch).submit(input),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("calls fetch without a method receiver like native fetch requires", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ticketReference: "SUP-7", status: "received" }, 201),
    ) as unknown as typeof fetch;
    const receiverStrictFetch = async function (
      this: unknown,
      ...args: Parameters<typeof fetch>
    ) {
      // Native fetch throws "Illegal invocation" when called as a method on
      // a non-Window receiver, so the client must use a bare call.
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Illegal invocation");
      }
      return fetchImpl(...args);
    };
    const client = new HttpSupportSubmissionClient({
      apiBaseUrl: "https://api.support-platform.example",
      fetchImpl: receiverStrictFetch,
    });

    await expect(client.submit(input)).resolves.toEqual({ reference: "SUP-7" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects non-HTTP(S) API URLs at construction", () => {
    expect(
      () =>
        new HttpSupportSubmissionClient({
          apiBaseUrl: "ftp://example.com",
          fetchImpl: fetch,
        }),
    ).toThrow();
  });
});
