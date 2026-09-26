# Phase 2 handoff — domain and database

## Completed

- Added `packages/db` with PostgreSQL 16, Drizzle schema/client, reviewed versioned migrations, scoped repository methods, input validation, and repeatable development seed data.
- Added one local Docker Compose PostgreSQL service with separate development and test databases. No production provider or credentials are required.
- Added six real PostgreSQL integration cases for tenant/project isolation, transactional submission, classification history, GitHub issue linkage, webhook delivery idempotency, and database constraints.
- Extended root database commands and GitHub Actions with migration verification and an isolated PostgreSQL integration test database.
- Updated the architecture, security, testing, agent, and decision documents to reflect the implemented model.

## Final repository structure

```text
apps/web/                       Platform Next.js application shell
apps/demo/                      Controlled Next.js consumer shell
packages/db/src/               Drizzle schema, client, inputs, repository, seed, tests
packages/db/migrations/        Versioned SQL and Drizzle snapshots
packages/db/docker/            Local test-database initialization
compose.yaml                    Local PostgreSQL 16 service
.github/workflows/ci.yml        Unit, database, type, lint, and build gates
docs/handoffs/                  Phase records
```

## Schema and invariants

| Table | Purpose |
| --- | --- |
| `workspaces` | Tenant root |
| `projects` | Workspace-owned website/application, public widget key, origin policy |
| `conversations` | Project-owned interaction and optional private visitor name/email |
| `messages` | Project/conversation-owned message with visitor/support/AI/system role |
| `tickets` | Project/conversation-owned workflow, `SUP-<number>` display reference, submission idempotency key and fingerprint |
| `ticket_classifications` | Append-only, provider-neutral validated decisions ordered by classification number |
| `ticket_events` | Minimal private workflow timeline |
| `github_integrations` | Project-to-repository GitHub App metadata, without credentials |
| `github_issues` | Pending intent or confirmed issue link, unique ticket and reconciliation marker |
| `webhook_events` | Delivery metadata and processing state, without raw payload |

PostgreSQL checks constrain product states, roles, routes, confidence, and remote issue field completeness. Composite foreign keys prevent a ticket, message, classification, event, or issue from linking across projects. Scoped repository reads require workspace and project IDs. Project public keys and submission keys have uniqueness constraints; webhook delivery IDs are unique per provider. Foreign keys restrict deletion of historical parents. Timestamps use `timestamptz`; UUIDv4 primary keys stay internal.

The repository atomically creates a conversation, first visitor message, ticket, and submission event. A repeated submission key with the same fingerprint returns its original ticket; changed content is rejected. Classification append and ticket route/state update share a transaction. The implemented state transitions are `needs_triage → queued/quarantined`, plus reclassification within `queued` or `quarantined`. Later services own escalation, resolution, and reopening.

## Migrations and commands

- `0000_worried_ego.sql` creates the initial domain tables, checks, indexes, and foreign keys.
- `0001_futuristic_mach_iv.sql` adds deterministic ordering for append-only classifications.
- `pnpm db:up` starts local PostgreSQL on port 54339. Copy `.env.example` to ignored `.env` first.
- `pnpm db:migrate` applies checked-in migrations; `pnpm db:generate` creates a migration after a schema change; `pnpm db:check` validates migration history.
- `pnpm db:seed` inserts one workspace, two projects, and four realistic tickets/classifications without AI or GitHub calls. Re-running it is safe.
- `pnpm test:db` migrates and tests only the isolated local `_test` database. Its URL guard rejects a nonlocal host, a database name without `_test`, and the development URL.
- `pnpm db:studio` opens local Drizzle Studio; `pnpm db:down` stops Compose while preserving the volume.

The development port is 54339 because 54329 was occupied on this machine. CI uses its own PostgreSQL 16 service on port 5432. CI is configured but has not run remotely because this phase has not been committed or pushed.

## Verification

| Command or check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed, including `packages/db` |
| `pnpm test` | Passed, 1 application smoke test |
| `pnpm test:db` | Passed, 6 PostgreSQL integration tests |
| `pnpm build` | Passed for both Next.js apps |
| `pnpm db:check` | Passed |
| `pnpm db:generate` | Reported no schema changes after checked-in migrations |
| Clean volume, `pnpm db:migrate`, `pnpm db:seed` | Passed from zero; repeat seed passed |
| `pnpm test:e2e` | Passed, 1 Chromium smoke test; local server ports required an unsandboxed run |
| `git diff --check` | Passed; no whitespace errors |

## Architecture changes and deviations

ADRs 010–014 document constrained text values, UUID/reference/lifecycle choices, issue intent/reconciliation, local PostgreSQL testing, and classification ordering. These refine the Phase 0 model without changing its product architecture. The persistent work item/outbox table remains deferred until AI triage and escalation workflows are implemented. Authentication tables and workspace memberships remain deferred. No widget, ticket HTTP API, live Jev/LLM/GitHub call, webhook handler, dashboard, or worker was added.

## Security and privacy

Visitor name and email are private conversation fields. Issue and webhook records carry metadata only, and seed data contains no credentials. Public project keys and `SUP-<number>` references grant no access. The scoped repository requires workspace/project context, but its caller must first authenticate and authorize that context in a later phase. Raw Drizzle tables are not intended as application route imports.

## Known issues and deferred decisions

- GitHub Actions has not been observed remotely; its first real run follows a later commit/push.
- The development database has no retention/deletion workflow; restrictive foreign keys intentionally prevent accidental cascading history loss.
- The eventual ticket API must add rate limiting, origin checks, payload limits, and server-side authorization for any private read. Public project keys are identifiers only.
- The Phase 4 API must compute the submission fingerprint from normalized request content on the server; it must never trust a browser-supplied fingerprint for idempotency conflict detection.
- Phase 5 needs a durable work/outbox record and classifier adapter; Phase 7 needs a GitHub App, a disposable repository, and remote reconciliation behavior. Hosting, scheduler, provider credentials, and package publication remain later decisions.
- The first live operation against Jev and GitHub has not been tested, by phase design.

## Exact starting point for Phase 3

After owner approval, create only the internal `packages/widget` React package and consume it from `apps/demo`. Implement the documented accessible widget states and public configuration shape against a mocked or local adapter as needed. Do not add the ticket ingestion HTTP API until Phase 4, and do not couple the widget to `packages/db` or server secrets. Keep the Phase 2 schema and repository boundary intact unless a concrete widget need reveals a documented change.
