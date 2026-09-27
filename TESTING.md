# Testing strategy

Phase 6 adds dashboard unit, database, and browser coverage with seeded-operator authentication. Future phase gates must run the relevant checks, update this file with new real commands, and record results in that phase's handoff. Do not claim an unrun check passed.

## Commands available now

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:check
pnpm test:db
pnpm test:ai
pnpm ai:evaluate
pnpm build
pnpm test:e2e
git diff --check
```

`pnpm test` runs database-free Vitest with React Testing Library in jsdom, including widget flows inside its ShadowRoot, the public route/ingestion contract suite against a fake repository, the HTTP submission client suite, and the AI unit suites (policy, fixture classifier, evaluation, triage service with fake repositories; the Jev adapter suite pins Node env because the official SDK refuses browser runtimes). `pnpm test:db` requires the isolated local PostgreSQL test database; it applies checked-in migrations and truncates only test tables between cases. `pnpm test:ai` runs the database-backed triage integration suite (end-to-end service flow with the fixture classifier: submission → triage → history/route/events, disagreement, spam quarantine, failure retryability, project isolation, concurrent convergence, pending-listing helpers) against the same isolated test database. `pnpm ai:evaluate` runs the versioned fixture set through the mock classifier (must pass 7/7; gates CI) or live Jev with `--classifier jev` (observations only, requires `TYPESAFE_API_KEY`). `pnpm ai:triage --pending` classifies real `needs_triage` tickets from the development database. `pnpm test:db` requires the isolated local PostgreSQL test database; it applies checked-in migrations and truncates only test tables between cases. Before testing locally, copy `.env.example` to `.env` and run `pnpm db:up`. The test URL guard rejects nonlocal hosts, names not ending `_test`, and the development URL. `pnpm db:check` validates the Drizzle migration history. `pnpm test:e2e` builds the shared packages once and serves both apps (`pnpm dev:e2e`: separate parallel dev commands each rebuild `dist` while the other app bundles it, which intermittently poisoned the demo bundle); the ingestion specs additionally require a migrated and seeded development database (`pnpm db:migrate && pnpm db:seed`) for the seeded demo project key and origin. Dashboard specs additionally require the seeded owner (`SEED_OWNER_EMAIL`/`SEED_OWNER_PASSWORD` trigger the bootstrap step of `pnpm db:seed`) and sign in through the real login form — no auth bypass. Client-button clicks wait for `networkidle` after navigation because clicks landing before dev chunk hydration never reach React. It runs Playwright Chromium checks for app shells, mock desktop/mobile widget flows, real demo-to-API submission with a ticket reference, API idempotent retry, and safe unknown-project/disallowed-origin behavior; install Chromium first with `pnpm exec playwright install chromium` if needed. `pnpm typecheck` checks root tooling, `packages/support-contracts`, `packages/widget`, both apps after `next typegen`, and `packages/db`. CI runs unit, database integration, migration check, and build checks with a PostgreSQL 16 service; browser tests remain a separate local gate.

## Layers

| Layer | Required coverage | External dependencies in CI |
| --- | --- | --- |
| Unit (Vitest) | Zod boundaries, public ingestion contract, origin/rate-limit/conflict mapping, fingerprint determinism, HTTP client serialization/error mapping (including the native-fetch receiver rule), classifier schemas, routing/escalation policy and thresholds, category disagreement, fixture evaluation, triage-service decisions with fake repositories, provider error mapping (stubbed transport), classification normalization, deterministic routing, confidence gates, issue mapping/redaction, ticket transitions, idempotency decisions | None; fake clock and adapters |
| Component (React Testing Library) | Widget keyboard flow, validation/errors, confirmation, focus management, accessible names and status announcements | None; mock public API |
| Integration (Vitest + test PostgreSQL) | Transactional ticket creation, duplicate and concurrent submissions, category-hint persistence, tenant scoping, classification persistence, triage end-to-end (history/route/events/failure/concurrency/isolation), issue intent/link constraints, webhook delivery deduplication; later work claims and webhook state changes | Isolated PostgreSQL test database; no Jev/GitHub calls |
| End-to-end (Playwright) | Demo website opens widget, submits bug, sees confirmation; real demo-to-API submission returns a ticket reference; API idempotent retry returns the same ticket; unknown project and disallowed origin fail safely; dashboard login, ticket inspection, mock re-triage with history growth, and resolve with timeline entry (seeded owner, no auth bypass); owner sees classification and escalation; simulated GitHub close/reopen updates ticket | Local apps/database; fixture adapters |
| Optional live smoke | Official Jev request and disposable GitHub App/repository integration | Explicit keys and test repo; excluded from ordinary CI |

Use realistic fixtures and assert outcomes, not merely that mocks were called. CI must remain useful without paid provider access. An optional live test may validate credentials and provider shape but must never use the production portfolio repository. Review accessibility with automated checks and manual keyboard/screen-reader inspection before widget publication.

## Core fixtures

| Input | Expected type and route | GitHub candidate |
| --- | --- | --- |
| “The projects section becomes blank in Safari after switching to dark mode.” | `bug`, engineering | Yes if confidence, connection, and privacy checks pass |
| “It would be great if the portfolio had a search bar.” | `feature_request`, product | No |
| “What technologies did you use to build this website?” | `question`, support | No |
| “Buy cheap cryptocurrency now...” | `spam`, quarantine | No |

Add fixtures for category-hint disagreement, ambiguous bug reports, private tokens/contact details, prompt injection, repeated submission keys, provider timeout, malformed provider output, GitHub timeout after send, duplicate webhook delivery, wrong repository/installation, issue edit, close, and reopen. Use two workspace/project fixtures to test isolation.

## Acceptance and phase gates

- **Phase 0:** All requested documents exist, agree on MVP scope and state flow, cite current Jev/GitHub integration sources, and name unresolved operational inputs. No application scaffold or dependencies are added.
- **Phase 1:** `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` work as documented. CI runs build, typecheck, lint, and tests; Playwright verifies both shells locally.
- **Phase 2:** Fresh PostgreSQL volume migrates and seeds; repeated seed is idempotent; migration generation reports no drift; six database integration cases cover constraints, transactions, idempotency, and tenant isolation.
- **Phase 3:** Internal widget builds independently, runs in the demo through its package export, validates fields, handles success/error/retry, and passes keyboard/focus plus desktop/mobile browser checks against a mock client.
- **Phase 4:** Demo widget submits to the public API and receives the same ticket on idempotent retry; API validation and abuse/error paths pass; concurrent identical submissions converge on one ticket; the widget client never calls captured fetch as a method.
- **Phases 5–6:** Validated classification persists, deterministic routes are correct, AI failures leave an actionable ticket, mock evaluation passes 7/7, dashboard shows history with human review, re-triage, resolve/reopen, and quarantine release, and unauthenticated dashboard access redirects to login.
- **Phases 7–9:** Exactly one linked issue is created for an eligible demo bug; uncertain creates require reconciliation; signed, duplicate, wrong-repository, closed, and reopened webhooks behave correctly. Questions, features, and spam create no engineering issue.
- **Phase 10 onward:** Review security, failure recovery, privacy, accessibility, external package installation, and production behavior before publication or portfolio use.

At every implementation phase: update affected docs and ADRs, run relevant tests/typecheck/lint, summarize technical debt and unresolved decisions, and write `docs/handoffs/phase-XX.md` with exact commands and results. Do not add trivial tests that only repeat implementation details; prioritize boundary and failure behavior.
