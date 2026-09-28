# Security model

Security controls are required at each boundary, not added only during hardening. This document is the design contract for later implementation phases.

## Trust boundaries

1. **Host website → widget:** The host can inspect or alter widget props. The project key is public identification, not a credential. No server key belongs in the package, page source, network request, or source map.
2. **Widget → public API:** Every field, including category hint, origin, idempotency key, and message, is untrusted. Browser origin restrictions reduce casual misuse but are not authentication because non-browser clients can forge `Origin`.
3. **Dashboard → services:** Better Auth establishes owner identity when added. Every project operation must also check workspace membership and project ownership. Client-provided project IDs do not grant access.
4. **Platform → AI and GitHub:** Provider adapters receive minimum data. Visitor content never controls credentials, repository selection, system instructions, or tool invocation. Jev receives only the visitor message and optional category hint — never name, email, IDs, workspace secrets, or GitHub credentials. The `TYPESAFE_API_KEY` is server-only, validated only in live-triage contexts, and never logged; the adapter pins SDK log level to `warn` so request bodies are never logged.

5. **GitHub → webhook API:** Verify a signature over the untouched raw request body before parsing or writing state. The signed payload still needs schema, event, installation, repository, and linked issue checks.

## AI triage (implemented in Phase 5)

Classification input is `{ message, categoryHint? }`, validated by Zod that strips anything else. The official SDK refuses browser runtimes, and the adapter is never imported by widget, demo, or web client code. Normalized confidence comes from the selected type label's probability; missing or out-of-range values fail closed to `AI_SCHEMA_VALIDATION_FAILED` with the ticket left in `needs_triage`. Internal error codes (`AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT`, `AI_INVALID_RESPONSE`, `AI_SCHEMA_VALIDATION_FAILED`, `AI_MISCONFIGURED`) never reach the widget — the visitor already holds ticket acceptance. Stored classifications carry type, severity, route, recommendation, confidence, and provenance only; no raw provider payloads. TypeSafe data-retention terms for submitted text were not verified; review them before production use.
## Public ingestion (implemented in Phase 4)

`POST /api/v1/support/tickets` enforces HTTPS in deployment, a 16 KB body cap (413), strict JSON content type (415), Zod parsing with bounded lengths, and a stable public error taxonomy (`INVALID_REQUEST`, `PROJECT_NOT_FOUND`, `ORIGIN_NOT_ALLOWED`, `RATE_LIMITED`, `SUBMISSION_CONFLICT`, `SUBMISSION_FAILED`, `BODY_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`) that never leaks SQL, stack traces, workspace existence, or internal IDs. Unknown or inactive project keys return 404 without revealing tenant details. Rate limiting is an atomic per-project hourly quota (120 submissions) in `submission_rate_limits`; it stores no IP or fingerprintable client signal, and successful idempotent retries return before consuming quota. No honeypot, timing check, or CAPTCHA was added; validation, origin policy, and quota are the current controls, with challenge mechanisms reserved for observed abuse. The endpoint uses no cookies or credentials, so no CSRF token applies; protection rests on project resolution, exact origin comparison, validation, and quota. Do not rely on the public project key or `Origin` for authentication: missing `Origin` is treated as a non-browser client, and forged origins remain possible outside browsers.

Browser `Origin` values are normalized with the `URL` parser (http/https only, exact `origin` match, no substring checks) and compared against the resolved project's `allowedOrigins`, which include a deliberate `http://127.0.0.1:3001` demo entry from seed. Preflight requires the `projectKey` query parameter and an allowed origin; success echoes only the resolved request origin, never `*`. Port, scheme, and localhost are compared exactly. The submission idempotency key is a UUID generated per action and scoped to the project; the server computes a versioned SHA-256 fingerprint over normalized category, message, and contact content, so browser-supplied fingerprints are never trusted for retry comparison.

The platform must preserve reports when Jev, the generator, or GitHub is down. If PostgreSQL is down, return an explicit failure and do not claim acceptance. Put rate limit and spam controls ahead of expensive model calls. Quarantined spam remains access-controlled, and automated deletion/retention requires a separate policy.

## Dashboard authentication and authorization (implemented in Phase 6)

Operator access uses Better Auth email/password with database sessions (`user`/`session`/`account`/`verification` plus `workspace_members`). Passwords are provider-hashed (minimum 12 characters); `TYPESAFE`-style provider keys are never involved. `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL` are server-only; the secret has no default and the app refuses to construct auth without it. Email verification is off until delivery exists — production must enable it. Browser code imports only `@ai-support-platform/auth/client` (session client); importing the package root into a client component bundles Node-only database code and breaks the build, which the login form regression-proves by using the subpath.

Every dashboard read resolves project→workspace and asserts membership server-side; unknown or foreign IDs return 404 without revealing existence. Mutations additionally require a request `Origin` matching the request host for cookie CSRF protection (a missing `Origin` is refused since Phase 10; the public widget flow stays credentialless and unaffected). Public self-signup endpoints return 404 unless `AUTH_ALLOW_SIGNUP=true`; the owner bootstraps via the seed flow. Callback URLs accept same-origin relative paths only. Dashboard routes are `force-dynamic` so authenticated pages are never statically cached or shared. Contact details render only on authorized detail pages, never in lists; override reasons are owner-written audit text, not visitor PII.

## Data isolation and authentication

Every dashboard read/write uses the authenticated user's workspace membership and project-scoped repository method. Query by project/workspace before looking up ticket, conversation, classification, or integration IDs. Add foreign keys and unique constraints that prevent cross-project associations. Test two workspaces with similarly shaped data and assert no cross-tenant reads or writes. Bootstrap one owner; public signup and invitation flows remain disabled until explicitly implemented. Protect dashboard mutations against CSRF according to Better Auth and Next.js guidance. Never expose secrets in serialized server components or public environment variables.

Phase 2 implements this boundary in `packages/db`: project reads require workspace context, and ticket/classification/message/issue links use composite project-matching foreign keys. Authentication and workspace membership remain deferred, so future callers must supply workspace context only after server-side authorization. Visitor name/email live only on private conversation rows; ticket events, classification reasons, and GitHub/webhook metadata must not copy them. The `SUP-<number>` reference and public project key do not authorize access.

## GitHub credentials, publication, and webhooks

Use a GitHub App with only the selected repository access and the minimum Issues permissions. Store its private key and webhook secret in server secret storage, mint installation tokens server-side, and never persist tokens in ticket data. Verify `X-Hub-Signature-256` using HMAC-SHA256 on raw bytes with a timing-safe comparison before JSON parsing. Persist delivery ID with a unique constraint and handle repeats idempotently. Validate the event/action and ensure installation, repository ID, and issue ID match the stored integration/link before changing a ticket. [GitHub signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

Before creating a GitHub issue, build a publication-safe projection of the report. Exclude name, email, account identifiers, tokens, authentication details, private URLs, and unrelated conversation messages by default. Redact detected secrets/PII from the remaining text; if redaction cannot establish a safe and useful issue, require owner review. The issue may show a platform ticket reference that is not a public link to private ticket content. Keep an explicit allowlist for labels and environment fields. Treat generated issue text as untrusted and run it through the same publication check. Document a process to correct an accidental publication rather than assuming redaction is perfect.

The Phase 2 webhook table stores delivery/event identifiers, context IDs, status, timestamps, and a short safe failure code. It does not store raw webhook payloads. The GitHub integration table stores installation/repository metadata only, and pending issue rows store a reconciliation marker before a future remote call. Neither table stores a personal access token, installation token, or GitHub App private key.

The Phase 4 ingestion API computes each submission fingerprint from validated, normalized request content on the server as specified above. The repository accepts a fingerprint as an internal input, but browser-supplied fingerprints are never trusted when deciding whether a repeated submission key matches the original request.

Structured logs record only `support_accepted`/`support_rejected`/`support_failed` with a request ID, project ID, and safe code. Visitor messages, names, emails, and raw bodies are never logged.

The Phase 4 widget receives only a public project key and an injected submission client. It imports no server-only package or environment secret. Its category is a visitor hint, not an authorization or trusted classification. The demo keeps its local mock alongside the real HTTP client; mock references stay visibly fake. Its ShadowRoot style element requires an inline-style compatible host Content Security Policy; test a strict-CSP consumer and choose a compatible delivery strategy before external package publication. External consumers must allow the support API domain in `connect-src`.

The local Compose password and URLs in `.env.example` are development-only. `.env` is ignored. Database integration tests require `DATABASE_URL_TEST` to point to localhost and a database ending `_test` before they truncate test tables; CI uses a dedicated PostgreSQL service. Do not point this variable at a production instance.

## GitHub escalation (implemented in Phase 7)

Escalation runs through a GitHub App (Issues read/write, Metadata read-only) with operator preview and confirmation — never automatic, never from visitor input. `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` are server-only env read only when escalation runs; JWT signing and short-lived installation-token minting stay inside the official SDK, and tokens are never persisted, logged, or sent to browsers. Installation/repository identity comes from the stored project integration, never from visitor text or request parameters.

Issue content is deterministic: bounded title, structured body with a screened report rendered in a Markdown code fence and an opaque ticket marker, labels intersected with existing repository labels. The privacy gate blocks emails, private/credential URLs, phone-shaped numbers, JWTs, private keys, API tokens, credential assignments, and card numbers for human review and never logs matched values; regexes reduce accidents but do not prove safety, so questionable content stays unpublished. Responses and dashboard output expose only number, URL (validated `https://github.com` before rendering as a link), and safe error codes — never tokens or raw API bodies.

Idempotency is layered: a unique intent row, atomic `creating` claim, opaque marker, strict App-authored reconciliation, guarded confirmation, and a unique remote-ID constraint. Ambiguous create failures mark `needs_reconciliation` for owner-driven review; clear GitHub rejections mark `retry_required`. A real duplicate-remote-ID collision during verification (mock IDs shared across tickets) confirmed the constraint fires correctly; mock IDs now derive from the marker. Rate limits (429/403-rate-limit) surface safe retry guidance without aggressive retries.

## GitHub webhook intake (implemented in Phase 8)

`GITHUB_WEBHOOK_SECRET` is read only by the server route at runtime; it is absent from browser exports and logs. The route caps actual streamed bytes at 1 MiB, verifies HMAC-SHA256 on those bytes using `timingSafeEqual`, and only then decodes/parses JSON. Missing, malformed, and mismatched signatures receive the same public `INVALID_SIGNATURE` response. The UUID delivery header is validated. No Better Auth session or cookie is needed: the HMAC is the route credential.

A unique `(provider, delivery_id)` constraint blocks replay, including concurrent instances. The delivery row and domain changes commit together; exceptions roll back and return 503. Unknown events/issues and invalid authenticated payloads are acknowledged without revealing ticket existence. Only safe IDs, action, state, and short failure codes are stored, never the raw payload. The service checks repository ID, remote issue ID and number, App installation ID, active integration, and project-matching foreign keys. The marker in an issue body is irrelevant for inbound authorization. Remote state events never copy GitHub title/body/comments into support content.

Security review: the signed body can still be malicious input, so the minimal Zod schema and bounded strings apply after verification. Missing installation on an issue event cannot mutate a linked ticket. The endpoint logs delivery ID, event/action, repository ID, issue number, and result only. A stolen secret would permit forged new delivery IDs; rotate it in the App and server. Exact duplicate IDs and repeated state changes are idempotent, while distinct delayed events can arrive out of order and require operator reconciliation. The 1 MiB cap limits memory use, but HMAC work and database writes can still be an abuse target if the secret is compromised; monitor 401/503 rates and latency.

## Demo journey completion (Phase 9)

Escalation additionally requires model/manual provenance or an owner recommendation (ADR-022), so synthetic fixture decisions cannot publish through a real App. The dashboard's unknown-outcome check can only reconcile a trusted App-authored issue, never create one. Previews no longer need App credentials; creation fails closed without them. Operator recovery, including accidental publication, is in [docs/GITHUB_RECOVERY.md](docs/GITHUB_RECOVERY.md). Before any further public exposure, replace the example `BETTER_AUTH_SECRET` and owner password: the live validation found both in use behind a public tunnel.

## Production hardening (Phase 10)

- Dashboard mutations require a same-origin `Origin`; publishing and overrides require the owner role (ADR-024). Post-login redirects are limited to same-origin `/dashboard` paths.
- Production startup fails closed on example/weak `BETTER_AUTH_SECRET`, non-HTTPS `BETTER_AUTH_URL`, short `GITHUB_WEBHOOK_SECRET`, `GITHUB_ESCALATION_MOCK`, or `AUTH_ALLOW_SIGNUP=true`; errors name settings, never values. Responses forbid framing and MIME sniffing and send HSTS in production.
- Out-of-order and pre-link webhook deliveries can no longer regress or lose issue state (ADR-023).
- `pnpm db:retention` erases contact details and old delivery rows (ADR-025).
- Dependency audit (2026-09-28): one moderate advisory, `esbuild` ≤0.24.2 (GHSA-67mh-4wv8-2f99), reached only through `better-auth → drizzle-kit → @esbuild-kit/*`. It affects esbuild's development `serve` mode, which this project never runs; accepted and to be rechecked on dependency updates.
- Still deferred to deployment: email verification with a delivery provider, hosting-level TLS/WAF, secret storage, and scheduled retention.

## Published widget (Phases 11–12)

The npm package contains only its built browser code, types, README, and license. `pnpm test:package` fails the release if the tarball carries extra files, private dependencies, `workspace:` ranges, devDependencies, Node built-ins, `process.env`, eval, platform package names, credential environment names, or key material, and if the consumer's bundle contains server code. Releases publish that verified tarball with npm provenance through trusted publishing (no stored token). The widget works under a strict CSP without `'unsafe-inline'` or `'unsafe-eval'`; hosts must allow the platform API origin in `connect-src`.

## Production deployment

Production secrets live in Vercel as sensitive variables, which `vercel env pull` never releases; migrations therefore run inside production builds. The startup guard requires unique auth and webhook secrets, `https` `BETTER_AUTH_URL`, `CRON_SECRET`, and complete email settings. The retention cron compares `Bearer $CRON_SECRET` in constant time. With Resend configured, sign-in requires a verified email; operator-created owners are marked verified by `pnpm setup:production`, whose password is read from a hidden prompt and never passed as an argument. Reset emails contain only a greeting and a one-hour link, and a reset revokes other sessions. Local `.env` must never point at production; production access is loaded from the git-ignored `.env.production.local` for single deliberate commands.

## Logs, retention, and incident response

Log ticket IDs, project IDs, provider/operation status, webhook delivery IDs, latency, and safe error codes. Do not log raw messages, contact information, API keys, webhook bodies, provider prompts, or complete GitHub issue payloads. Set retention and deletion policy before live deployment, including how contact data and webhook diagnostics are removed. Rotate compromised credentials and public project keys, disable a project integration when needed, and reconcile remote issues after incidents or ambiguous API outcomes.

Before exposing a local instance through a public tunnel, replace the documented example owner password and `BETTER_AUTH_SECRET` with unique values. The tunnel exposes the login and dashboard as well as the webhook endpoint. A failed or stale `creating` claim must be reconciled by an operator; it cannot authorize a second create automatically.
