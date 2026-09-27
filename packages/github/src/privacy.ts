export interface PrivacyFinding {
  kind:
    | "email"
    | "private-key"
    | "api-token"
    | "credential-assignment"
    | "card-number"
    | "private-url"
    | "phone-number"
    | "jwt";
}

const CHECKS: Array<{ kind: PrivacyFinding["kind"]; pattern: RegExp }> = [
  { kind: "email", pattern: /[\w.+-]+@[\w-]+\.[\w.]+/ },
  {
    kind: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    kind: "api-token",
    pattern:
      /\b(ghp_[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|sk-(live|test)-[A-Za-z0-9]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9-_.~+/]{8,})/,
  },
  {
    kind: "credential-assignment",
    pattern:
      /\b(passw(or)?d|passwd|pwd|secret|api[_-]?key)\s*[:=]\s*['"]?\S{4,}['"]?/i,
  },
  {
    kind: "card-number",
    pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/,
  },
  {
    kind: "phone-number",
    pattern: /(?<![\w-])\+?(?:\d[\s().-]?){8,14}\d(?![\w-])/,
  },
  {
    kind: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\b/,
  },
];

function containsPrivateUrl(message: string): boolean {
  const urls = message.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return urls.some((raw) => {
    try {
      const url = new URL(raw.replace(/[.,;!?)]*$/, ""));
      const host = url.hostname.toLowerCase();
      return (
        Boolean(url.username || url.password) ||
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".internal") ||
        host.endsWith(".local") ||
        /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        host === "hooks.slack.com" ||
        /\b(token|secret|key|auth|signature|password)\b/i.test(url.search)
      );
    } catch {
      return true;
    }
  });
}

export interface PrivacyScreen {
  safe: boolean;
  /** Finding kinds only; never includes matched values. */
  findings: PrivacyFinding["kind"][];
}

/**
 * Deterministic pre-publication screen. Conservative by design: any finding
 * blocks escalation for human review. Regexes cannot catch every secret;
 * this gate reduces accidents, it does not prove content safe.
 */
export function screenReport(message: string): PrivacyScreen {
  const findings = CHECKS.filter((check) => check.pattern.test(message)).map(
    (check) => check.kind,
  );
  if (containsPrivateUrl(message)) findings.push("private-url");
  return { safe: findings.length === 0, findings };
}

/** Defensive redaction for derived excerpts; the gate above still decides. */
export function redactEmails(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[redacted-email]");
}
