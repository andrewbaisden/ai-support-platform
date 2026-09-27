import { describe, expect, it } from "vitest";
import { trustedReconciliationIssue } from "./reconciliation";

const marker =
  "<!-- ai-support-ticket:SUP-123:9e949262a94b4ba6a913b562f821c9a3 -->";
const issue = {
  id: 42,
  number: 7,
  html_url: "https://github.com/demo/disposable/issues/7",
  body: `## Report\n\nSynthetic bug\n\n${marker}\n`,
  user: { login: "support-app[bot]", type: "Bot" },
};

describe("GitHub reconciliation identity", () => {
  it("accepts an exact standalone marker from the configured App bot", () => {
    expect(trustedReconciliationIssue(issue, marker, "support-app")).toEqual({
      id: 42,
      number: 7,
      url: issue.html_url,
    });
  });

  it("ignores planted markers, partial markers, pull requests, and malformed identities", () => {
    expect(
      trustedReconciliationIssue(
        { ...issue, user: { login: "attacker", type: "User" } },
        marker,
        "support-app",
      ),
    ).toBeUndefined();
    expect(
      trustedReconciliationIssue(
        { ...issue, body: `quote ${marker} here` },
        marker,
        "support-app",
      ),
    ).toBeUndefined();
    expect(
      trustedReconciliationIssue(
        { ...issue, pull_request: { url: "https://api.github.com/pulls/7" } },
        marker,
        "support-app",
      ),
    ).toBeUndefined();
    expect(
      trustedReconciliationIssue({ ...issue, id: "42" }, marker, "support-app"),
    ).toBeUndefined();
  });
});
