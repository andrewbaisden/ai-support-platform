# Phase 4 handoff — public ticket ingestion API

## Completed

- Added `POST /api/v1/support/tickets` (plus `OPTIONS` preflight) in `apps/web`, with Zod validation, a 16 KB body cap, project resolution from `projectKey`, exact origin comparison, a database-backed hourly quota, and a safe public error taxonomy.
- Added narrow `packages/support-contracts` with the submission request/response/error schemas and category values shared by the API and the widget; no database, server, AI, or GitHub types cross the boundary.
- Added `HttpSupportSubmissionClient` implementing the Phase 3 `SupportSubmissionClient` interface (serialization, 10 s timeout, typed response/errors, retry-safe submission identifier). Fixed a real bug found by E2E: the client called captured `fetch` as an instance method, and native fetch throws "Illegal invocation" with a non-global receiver. The client now resolves `fetch` at call time with a bare call; a regression test pins the receiver rule.
- Wired `apps/demo` real local API mode (mock retained for deterministic UI work), with `NEXT_PUBLIC_SUPPORT_API_URL` override documented in `.env.example`.
- Persisted each accepted submission transactionally as Conversation + visitor Message + Ticket (`needs_triage`, visitor category as `categoryHint` only) + `submitted` TicketEvent. No classification, AI, GitHub, webhook, dashboard, or auth code was added.
- Implemented project-scoped idempotency: unique `(project_id, submission_key)` constraint as final arbiter, pre-check fast path, re-read after unique violations, and a versioned server-computed SHA-256 fingerprint; same key with different content returns 409.
- Extended the schema with `tickets.category_hint` and `submission_rate_limits` (migration `0002`), atomic hourly quota of 120 submissions per project with no client IP storage.
- Made `loadRootEnv` resolve the root `.env` from package scripts and Next.js runtimes (bundler-rewritten `import.meta.url` broke the original resolution and returned 503 for every request).
- Changed Playwright to one `pnpm dev:e2e` server command that builds shared packages once before starting both apps; parallel dev commands rebuilt `dist` while the other app bundled it.

## Public endpoint and contract

`POST /api/v1/support/tickets`, JSON, `Content-Type: application/json`, 16 KB limit.

Request: `{ projectKey: "pk_…(32)", category: "question" | "bug" | "feature_request", message: "10–10 000 chars", contact?: { name?: "≤120", email?: "≤320" }, submissionId: uuid }` (strict object).

Success: `201 { ticketReference: "SUP-<number>", status: "received" }`.

Errors: `400 INVALID_REQUEST`, `404 PROJECT_NOT_FOUND`, `403 ORIGIN_NOT_ALLOWED`, `409 SUBMISSION_CONFLICT`, `429 RATE_LIMITED`, `413 BODY_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `503 SUBMISSION_FAILED`. No SQL, stack, workspace, or internal-ID detail. Missing `Origin` is treated as a non-browser client; preflight requires `?projectKey=` and echoes only the resolved origin, never `*`. No cookies/credentials, so no CSRF token.

## Submission client architecture

`SupportWidget` still depends only on the `SupportSubmissionClient` interface. `HttpSupportSubmissionClient({ apiBaseUrl, timeoutMs?, fetchImpl? })` builds `POST {apiBaseUrl}/api/v1/support/tickets?projectKey=…`, maps public error codes plus `TIMEOUT`/`NETWORK_ERROR`/`INVALID_RESPONSE` into `HttpSubmissionError`, and omits empty contact details. It assumes cross-origin production use (CORS, no cookies).

## Persistence transaction

`submitSupportRequest` (in `apps/web/lib/support-ingestion.ts`) coordinates: resolve project → fingerprint → idempotent fast-path read → consume quota → `createSubmission` transaction (re-check active project, insert conversation, visitor message, ticket with `submissionKey`/`requestFingerprint`/`categoryHint`, `submitted` event). Unique-violation races re-read and compare fingerprints. Route handlers (`support-route.ts`) own HTTP only; `support-runtime.ts` owns repository construction.

## Idempotency/fingerprint strategy

Client UUID per user action (widget reuses the key for unchanged draft retries), scoped to the resolved project by the unique constraint. Fingerprint is `sha256(JSON([1, category, message, name ?? "", email ?? ""]))`, hex only, PII never stored in the clear as a fingerprint. Same key + same fingerprint → same `SUP-` reference without consuming quota; same key + different fingerprint → 409.

## Origin/CORS/rate-limit strategy

Exact `URL`-parser origin normalization (http/https, no substring matching); missing origin allowed as non-browser; invalid or unlisted origin rejected. Preflight 204 carries `Allow-Methods/Headers` and echoes the resolved origin. Rate limit: 120 submissions per project per UTC hour via atomic upsert; retries that hit existing tickets bypass quota. No IP persistence, no honeypot/CAPTCHA yet (reserved for observed abuse).

## Privacy/security decisions

Contact details live only on private conversation rows; logs carry request ID, project ID, and safe codes only; responses expose only the ticket reference and `received` status; fixtures use synthetic data. Project enumeration returns uniform 404s. See updated `SECURITY.md`.

## Test results

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed; 62 files, no findings |
| `pnpm typecheck` | Passed (tooling, contracts, widget, apps, db) |
| `pnpm test` | Passed: 25 tests across 4 files (route contract ×14, HTTP client ×5, widget ×5, web shell ×1) |
| `pnpm test:db` | Passed: 7 PostgreSQL cases incl. new concurrent-retry convergence test |
| `pnpm build` | Passed; route listed as dynamic `/api/v1/support/tickets` |
| `pnpm db:migrate && pnpm db:seed` | Passed against clean local volume |
| `pnpm test:e2e` | Passed: 6 Chromium cases (shells, mock flows, real widget submission, API retry, safe rejections) |
| `git diff --check` | Passed |
| Manual curl | 201 + identical retry reference, 404 unknown project, 403 disallowed origin, 204 preflight with exact ACAO |

## Deviations

- ADR-016 records the contracts package, database-backed quota, server fingerprint, and service/route split.
- `loadRootEnv` gained working-directory `.env` candidates because `import.meta.url` is unreliable after Next.js transpilation.
- `dev:e2e`/`playwright.config.ts` serialize package builds before serving both apps.
- No honeypot/timing spam controls (design reserves them for observed abuse); no per-IP signal (privacy).

## Known issues

- Quota (120/hour) and body cap (16 KB) are fixed constants; make them project/env-tunable if abuse or legitimate volume demands it.
- `next-env.d.ts` churns between dev/build typegen paths; reverted from this diff, regenerate via typecheck as needed.
- E2E gates on the demo URL only; the API specs assume the web app boots alongside (true in practice, unproven under extreme slowness).
- Strict host CSP implications (`connect-src` for the API domain, inline widget styles) remain for publication phases.

## Deferred work

Jev classification, AI answers/generation, GitHub escalation/webhooks, dashboard, auth, duplicate detection, notifications, npm publication — all later phases. `categoryHint` and `needs_triage` tickets are the Phase 5 input.

## Exact Phase 5 starting point

After owner approval, build the Jev classifier adapter over persisted `needs_triage` tickets using `categoryHint` as an input signal only; write validated `TicketClassification` rows through the existing guarded transitions. Do not change the ingestion contract, idempotency model, or widget client to do it.
