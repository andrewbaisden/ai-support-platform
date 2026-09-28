export interface PrivacyFinding {
  kind:
    | "email"
    | "private-key"
    | "api-token"
    | "credential-assignment"
    | "card-number"
    | "private-url"
    | "phone-number"
    | "jwt"
    | "contact-detail";
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
      /\b(gh[opusr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|[sr]k[-_](live|test)[-_][A-Za-z0-9]{8,}|sk-(proj-)?[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9-_.~+/]{8,})/,
  },
  {
    kind: "credential-assignment",
    pattern:
      /\b(passw(or)?d|passwd|pwd|secret|api[_-]?key|((access|auth|refresh|session)[_-]?)?token)\s*[:=]\s*['"]?\S{4,}['"]?/i,
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

export interface SubmittedContact {
  name?: string | null;
  email?: string | null;
}

const MIN_CONTACT_NAME_LENGTH = 3;

function normalizeWords(text: string): string {
  return ` ${text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ")} `;
}

/**
 * The visitor's own submitted name or email repeated in the report. Name
 * matching is whole-phrase and case-insensitive; partial names, nicknames,
 * and other people's names are not detected.
 */
function containsSubmittedContact(
  message: string,
  contact: SubmittedContact,
): boolean {
  const email = contact.email?.trim().toLowerCase();
  if (email && message.toLowerCase().includes(email)) return true;
  const name = normalizeWords(contact.name ?? "").trim();
  return (
    name.length >= MIN_CONTACT_NAME_LENGTH &&
    normalizeWords(message).includes(` ${name} `)
  );
}

/**
 * Deterministic pre-publication screen. Conservative by design: any finding
 * blocks escalation for human review. Regexes cannot catch every secret;
 * this gate reduces accidents, it does not prove content safe. Pass the
 * ticket's submitted contact so a report that repeats it is also held back.
 */
export function screenReport(
  message: string,
  options: { contact?: SubmittedContact | null } = {},
): PrivacyScreen {
  const findings = CHECKS.filter((check) => check.pattern.test(message)).map(
    (check) => check.kind,
  );
  if (containsPrivateUrl(message)) findings.push("private-url");
  if (options.contact && containsSubmittedContact(message, options.contact)) {
    findings.push("contact-detail");
  }
  return { safe: findings.length === 0, findings };
}

/** Defensive redaction for derived excerpts; the gate above still decides. */
export function redactEmails(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[redacted-email]");
}
