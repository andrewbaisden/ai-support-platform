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

  // Synthetic credential shapes only, assembled at runtime so no
  // credential-shaped literal is committed (secret scanners flag them).
  const body = "16C7e42F292c6912E7710c838347Ae178B4a";
  it.each([
    ["GitHub App installation token", `${"ghs"}_${body}`],
    ["GitHub user-to-server token", `${"ghu"}_${body}`],
    ["Stripe live secret key", `${"sk"}_${"live"}_${body}`],
    ["Stripe test secret key", `${"sk"}_${"test"}_${body}`],
    ["OpenAI-style project key", `${"sk"}-${"proj"}-${body}`],
    ["Bearer header", "Authorization: Bearer abc.def-ghi_jkl~mno"],
  ])("blocks a pasted %s", (_label, secret) => {
    const screen = screenReport(`Console shows ${secret} after login.`);
    expect(screen.safe).toBe(false);
    expect(screen.findings).toContain("api-token");
    expect(JSON.stringify(screen)).not.toContain(secret);
  });

  it.each([
    "token=4f9c2e1a7b3d",
    "access_token: 4f9c2e1a7b3d",
    "auth-token = '4f9c2e1a7b3d'",
    "API_KEY=4f9c2e1a7b3d",
  ])("blocks the credential assignment %s", (text) => {
    expect(screenReport(`Debug output: ${text}`).findings).toContain(
      "credential-assignment",
    );
  });

  it("does not block ordinary bug vocabulary near sensitive words", () => {
    for (const text of [
      "Safari 17.4.1 on macOS 14.5 shows a blank projects section.",
      "The tokenizer splits the heading wrongly on 2026-09-27.",
      "The password reset page is blank in dark mode.",
      "Build 1234 of version 2.10.3 regressed the export page.",
    ]) {
      expect(screenReport(text), text).toEqual({ safe: true, findings: [] });
    }
  });

  it("blocks the visitor's own submitted contact details in the report", () => {
    const contact = { name: "Ada Tester", email: "ada.tester@example.test" };
    const withName = screenReport(
      "Hi, ada tester here: the projects section is blank in Safari.",
      { contact },
    );
    expect(withName).toEqual({ safe: false, findings: ["contact-detail"] });
    expect(JSON.stringify(withName)).not.toContain("Ada");
    expect(
      screenReport("The projects section is blank in Safari.", { contact }),
    ).toEqual({ safe: true, findings: [] });
    // Name matching is whole-phrase: an embedded substring is not the name.
    expect(screenReport("The badatester module fails.", { contact }).safe).toBe(
      true,
    );
    // Too-short names cannot be matched without constant false positives.
    expect(
      screenReport("It is blank.", { contact: { name: "It", email: null } })
        .safe,
    ).toBe(true);
  });

  it("redacts emails from excerpts without deciding policy", () => {
    expect(redactEmails("Mail ada@example.com now")).toBe(
      "Mail [redacted-email] now",
    );
  });
});
