# Security model

Security controls are required at each boundary, not added only during hardening. This document is the design contract for later implementation phases.

## Trust boundaries

1. **Host website → widget:** The host can inspect or alter widget props. The project key is public identification, not a credential. No server key belongs in the package, page source, network request, or source map.
2. **Widget → public API:** Every field, including category hint, origin, idempotency key, and message, is untrusted. Browser origin restrictions reduce casual misuse but are not authentication because non-browser clients can forge `Origin`.
3. **Dashboard → services:** Better Auth establishes owner identity when added. Every project operation must also check workspace membership and project ownership. Client-provided project IDs do not grant access.
4. **Platform → AI and GitHub:** Provider adapters receive minimum data. Visitor content never controls credentials, repository selection, system instructions, or tool invocation.
5. **GitHub → webhook API:** Verify a signature over the untouched raw request body before parsing or writing state. The signed payload still needs schema, event, installation, repository, and linked issue checks.

## Public ingestion

Use HTTPS, a strict body-size limit, Zod parsing, bounded text lengths, and structured errors. Rate-limit by project and a privacy-conscious client signal such as hashed IP, with short retention; add a honeypot or challenge only if observed abuse warrants it. Do not rely on the public project key or `Origin` for authentication. Maintain a project allowed-origin list for browser requests and CORS, plus a deliberate local-demo setting. Reject unknown or inactive project keys without revealing tenant details. Avoid reflecting unsanitized visitor text into HTML. The submission idempotency key is a UUID generated per action and scoped to the project.

The platform must preserve reports when Jev, the generator, or GitHub is down. If PostgreSQL is down, return an explicit failure and do not claim acceptance. Put rate limit and spam controls ahead of expensive model calls. Quarantined spam remains access-controlled, and automated deletion/retention requires a separate policy.

## Data isolation and authentication

Every dashboard read/write uses the authenticated user's workspace membership and project-scoped repository method. Query by project/workspace before looking up ticket, conversation, classification, or integration IDs. Add foreign keys and unique constraints that prevent cross-project associations. Test two workspaces with similarly shaped data and assert no cross-tenant reads or writes. Bootstrap one owner; public signup and invitation flows remain disabled until explicitly implemented. Protect dashboard mutations against CSRF according to Better Auth and Next.js guidance. Never expose secrets in serialized server components or public environment variables.

Phase 2 implements this boundary in `packages/db`: project reads require workspace context, and ticket/classification/message/issue links use composite project-matching foreign keys. Authentication and workspace membership remain deferred, so future callers must supply workspace context only after server-side authorization. Visitor name/email live only on private conversation rows; ticket events, classification reasons, and GitHub/webhook metadata must not copy them. The `SUP-<number>` reference and public project key do not authorize access.

## GitHub credentials, publication, and webhooks

Use a GitHub App with only the selected repository access and the minimum Issues permissions. Store its private key and webhook secret in server secret storage, mint installation tokens server-side, and never persist tokens in ticket data. Verify `X-Hub-Signature-256` using HMAC-SHA256 on raw bytes with a timing-safe comparison before JSON parsing. Persist delivery ID with a unique constraint and handle repeats idempotently. Validate the event/action and ensure installation, repository ID, and issue ID match the stored integration/link before changing a ticket. [GitHub signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

Before creating a GitHub issue, build a publication-safe projection of the report. Exclude name, email, account identifiers, tokens, authentication details, private URLs, and unrelated conversation messages by default. Redact detected secrets/PII from the remaining text; if redaction cannot establish a safe and useful issue, require owner review. The issue may show a platform ticket reference that is not a public link to private ticket content. Keep an explicit allowlist for labels and environment fields. Treat generated issue text as untrusted and run it through the same publication check. Document a process to correct an accidental publication rather than assuming redaction is perfect.

The Phase 2 webhook table stores delivery/event identifiers, context IDs, status, timestamps, and a short safe failure code. It does not store raw webhook payloads. The GitHub integration table stores installation/repository metadata only, and pending issue rows store a reconciliation marker before a future remote call. Neither table stores a personal access token, installation token, or GitHub App private key.

The Phase 4 ingestion API must compute each submission fingerprint from validated, normalized request content on the server. The repository accepts a fingerprint as an internal input, but browser-supplied fingerprints must never be trusted when deciding whether a repeated submission key matches the original request.

The Phase 3 widget receives only a public project key and an injected submission client. It imports no server-only package or environment secret. Its category is a visitor hint, not an authorization or trusted classification. The demo client is local mock behavior and creates no ticket. Its ShadowRoot style element requires an inline-style compatible host Content Security Policy; test a strict-CSP consumer and choose a compatible delivery strategy before external package publication.

The local Compose password and URLs in `.env.example` are development-only. `.env` is ignored. Database integration tests require `DATABASE_URL_TEST` to point to localhost and a database ending `_test` before they truncate test tables; CI uses a dedicated PostgreSQL service. Do not point this variable at a production instance.

## Logs, retention, and incident response

Log ticket IDs, project IDs, provider/operation status, webhook delivery IDs, latency, and safe error codes. Do not log raw messages, contact information, API keys, webhook bodies, provider prompts, or complete GitHub issue payloads. Set retention and deletion policy before live deployment, including how contact data and webhook diagnostics are removed. Rotate compromised credentials and public project keys, disable a project integration when needed, and reconcile remote issues after incidents or ambiguous API outcomes.
