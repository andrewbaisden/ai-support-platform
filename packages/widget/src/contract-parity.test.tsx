import {
  publicErrorResponseSchema,
  ticketSubmissionRequestSchema,
  ticketSubmissionResponseSchema,
} from "@ai-support-platform/support-contracts";
import { describe, expect, it } from "vitest";
import { readErrorCode, readTicketReference } from "./http-submission-client";
import { validateSupportForm } from "./validation";

// The widget validates without Zod; the server validates with the contract
// schemas. These cases keep the two from drifting apart.
const messages = [
  "The projects section is blank in Safari.",
  "short",
  "          padded          ",
  "a".repeat(10_000),
  "a".repeat(10_001),
  ` ${"x".repeat(9)} `,
];
const names = ["", "Ada Tester", "  Ada  ", "a".repeat(120), "a".repeat(121)];
const emails = [
  "",
  "ada@example.com",
  "ada.tester+support@mail.example.co.uk",
  "not-an-email",
  "ada@localhost",
  ".ada@example.com",
  "ada..tester@example.com",
  "ada@-example.com",
  `${"a".repeat(310)}@example.com`,
];

function serverAccepts(message: string, name: string, email: string) {
  const contact = {
    ...(name.trim() ? { name } : {}),
    ...(email ? { email } : {}),
  };
  return ticketSubmissionRequestSchema.safeParse({
    projectKey: `pk_${"A".repeat(32)}`,
    category: "bug",
    message,
    ...(Object.keys(contact).length > 0 ? { contact } : {}),
    submissionId: "11111111-1111-4111-8111-111111111111",
  }).success;
}

describe("widget validation matches the submission contract", () => {
  it("accepts and rejects the same form input as the server schema", () => {
    for (const message of messages) {
      for (const name of names) {
        for (const email of emails) {
          const widget = validateSupportForm({
            category: "bug",
            message,
            name,
            email,
          });
          expect(
            Object.keys(widget.errors).length === 0,
            JSON.stringify({ message: message.slice(0, 20), name, email }),
          ).toBe(serverAccepts(message, name, email));
        }
      }
    }
  });

  it("reads responses exactly like the contract response schemas", () => {
    const responses: unknown[] = [
      { ticketReference: "SUP-42", status: "received" },
      { ticketReference: "SUP-0", status: "received" },
      { ticketReference: "SUP-42", status: "queued" },
      { ticketReference: "SUP-42", status: "received", extra: true },
      { ticketReference: 42, status: "received" },
      { error: { code: "RATE_LIMITED" } },
      { error: { code: "SOMETHING_ELSE" } },
      { error: { code: "RATE_LIMITED", detail: "x" } },
      { error: { code: "RATE_LIMITED" }, extra: 1 },
      null,
      [],
      "SUP-42",
    ];
    for (const body of responses) {
      const label = JSON.stringify(body);
      expect(readTicketReference(body) !== undefined, label).toBe(
        ticketSubmissionResponseSchema.safeParse(body).success,
      );
      expect(readErrorCode(body) !== undefined, label).toBe(
        publicErrorResponseSchema.safeParse(body).success,
      );
    }
  });
});
