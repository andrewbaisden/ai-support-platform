import { describe, expect, it } from "vitest";
import { redactEmails, screenReport } from "./privacy";

describe("privacy screen", () => {
  it("passes clean bug reports", () => {
    expect(
      screenReport("The projects section becomes blank in Safari dark mode."),
    ).toEqual({ safe: true, findings: [] });
    expect(
      screenReport("Probe b988d97b-104b-4167-9913-3a915a7f48d0 failed."),
    ).toEqual({ safe: true, findings: [] });
  });

  it("blocks emails, keys, tokens, credentials, and card numbers", () => {
    expect(
      screenReport("Contact me at ada@example.com about this bug.").safe,
    ).toBe(false);
    expect(
      screenReport("Here is my key: -----BEGIN PRIVATE KEY----- abc").findings,
    ).toContain("private-key");
    expect(
      screenReport("Token ghp_abcdefgh12345678 leaked").findings,
    ).toContain("api-token");
    expect(screenReport("sk-live-abcdefgh12345678").findings).toContain(
      "api-token",
    );
    expect(screenReport("My password: hunter2-hunter").findings).toContain(
      "credential-assignment",
    );
    expect(
      screenReport("Card 4111 1111 1111 1111 was charged").findings,
    ).toContain("card-number");
  });

  it("never includes matched values in findings", () => {
    const screen = screenReport(
      "Email ada@example.com and794828 token ghp_abcdefgh12345678",
    );
    expect(JSON.stringify(screen)).not.toContain("ada@example.com");
    expect(JSON.stringify(screen)).not.toContain("ghp_abcdefgh12345678");
  });

  it("blocks private URLs, phone numbers, and JWT-shaped credentials", () => {
    expect(screenReport("See http://localhost:3000/admin").findings).toContain(
      "private-url",
    );
    expect(
      screenReport("See https://hooks.slack.com/services/T/B/secret").findings,
    ).toContain("private-url");
    expect(
      screenReport("See https://example.com/?token=abc").findings,
    ).toContain("private-url");
    expect(screenReport("Call +44 7700 900123").findings).toContain(
      "phone-number",
    );
    expect(
      screenReport(
        "JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
      ).findings,
    ).toContain("jwt");
  });

  it("redacts emails from excerpts without deciding policy", () => {
    expect(redactEmails("Mail ada@example.com now")).toBe(
      "Mail [redacted-email] now",
    );
  });
});
