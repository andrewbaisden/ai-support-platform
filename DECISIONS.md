# Architectural decisions

These decisions apply to the MVP unless later evidence justifies an ADR amendment. Record an amendment before changing a cross-package contract or trust boundary. Source links were checked during Phase 0 on 2026-09-26; verify current SDK details again before installing or integrating a dependency.

## ADR-001 — Drizzle and PostgreSQL

**Decision:** Use PostgreSQL with Drizzle ORM and checked-in, reviewed SQL migrations. Keep queries behind project-scoped repository functions. Do not add Prisma.

**Why:** The domain has clear relational constraints and benefits from explicit SQL, composite unique keys, and controlled migrations. Drizzle keeps the SQL shape visible and offers generated migration files. Prisma provides a mature schema/client workflow, but a second schema language and generated client are unnecessary here. This is a fit decision, not a claim that Prisma is unsuitable. [Drizzle migration documentation](https://orm.drizzle.team/docs/migrations); [Prisma migration documentation](https://www.prisma.io/docs/orm/prisma-migrate)

**Consequence:** Review generated SQL and run migrations against a fresh database in CI. Never use schema push as the production migration path. Model tenant constraints explicitly; TypeScript types alone do not enforce isolation.

## ADR-002 — Better Auth when dashboard access is needed

**Decision:** Use Better Auth with its Drizzle adapter for the owner dashboard. Do not add authentication to the public widget API, and do not create auth tables in Phase 0 or Phase 1 before the domain/dashboard requires them. Disable public signup for the first live MVP and bootstrap one owner through a controlled setup flow.

**Why:** Better Auth can use the application database and Drizzle, which keeps owner accounts and sessions under the project's control. Clerk offers polished hosted auth and organization features, but introduces an external identity dependency and overlaps with the deliberately small first-owner requirement. Reassess for team invitations or public signup later. [Better Auth installation and Drizzle adapter](https://better-auth.com/docs/installation); [Clerk Next.js setup](https://clerk.com/docs/nextjs/getting-started/quickstart)

**Consequence:** Implement secure session handling, CSRF protections offered by the provider, and explicit workspace authorization in application services. A valid session alone does not authorize a project.

## ADR-003 — Provider-neutral bounded classification

**Decision:** Define an application `TicketClassifier` contract and a `JevTicketClassifier` adapter. Use the official server-side `@typesafe-ai/sdk` with `TypeSafeClient.systemOne` and bounded questions. Normalize and validate the result with Zod before policy uses it. Do not call a chat-completions endpoint for Jev. [Official TypeSafe JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/README.md)

**Why:** Jev supplies bounded judgment; code owns routing, thresholds, repository selection, and side effects. The adapter allows fixture-based tests and provider replacement. A separate `IssueDraftGenerator` contract may use a generative model for prose; its failure falls back to a deterministic template.

**Consequence:** Treat provider confidence as a signal rather than proof. Preserve model/version and decision provenance. Evaluate on labeled examples before enabling automatic escalation, then monitor false positives and adjust the policy threshold without changing the provider contract.

## ADR-004 — GitHub App and automatic escalation

**Decision:** Use a GitHub App installed on selected repositories with minimum necessary repository permissions. Automatically create issues only for connected-project engineering bugs above an initial **0.90 normalized classification confidence** threshold, after redaction checks pass. Lower confidence, missing context, sensitive content, missing integration, or policy uncertainty goes to owner review. The threshold is a policy default to calibrate with labeled fixtures before live activation. [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app); [issue create permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)

**Why:** GitHub is the engineering system, not a mirror of every support ticket. App installation scopes access per repository and avoids shared personal access tokens. Human review protects public repositories from accidental publication of private details and low-quality reports.

**Consequence:** The ticket remains valid if issue creation fails. The configured repository comes only from the project's verified integration. No browser or visitor input can choose a repository. Use a disposable repository for the first live integration.

## ADR-005 — Small durable Postgres work queue

**Decision:** Persist classification and issue escalation work in PostgreSQL in the same transaction as relevant ticket state changes. A scheduled worker claims due work with leases and bounded retries. Process the small webhook state update synchronously after signature verification.

**Why:** Public ticket acceptance must not depend on Jev or GitHub. A serverless request cannot rely on unawaited background work. A database-backed queue is enough for expected MVP volume and avoids an extra Redis/BullMQ service.

**Consequence:** Give work items observable statuses and safe error summaries. Reassess a dedicated queue when throughput, retry scheduling, or operations show a concrete need.

## ADR-006 — Public keys, idempotency, and issue reconciliation

**Decision:** The widget project key is public identification, never authentication. Submission requests include a per-action idempotency UUID. Persist a unique `(project_id, idempotency_key)` pair and request fingerprint; a reused key with changed content is a conflict. Use a unique GitHub webhook delivery ID. For GitHub issue creation, persist a stable ticket marker, and place ambiguous remote outcomes in reconciliation before retrying.

**Why:** Browser keys are observable, browsers retry requests, GitHub retries webhooks, and remote issue creation has no application idempotency key. A local unique constraint cannot prevent a duplicate remote issue after a network timeout. [GitHub webhook delivery guidance](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

**Consequence:** Rate limits and origin policy still protect the public endpoint. Owner-visible `needs_reconciliation` is a legitimate state rather than a silent failure.

## ADR-007 — Internal React widget first

**Decision:** Build the widget as an internal React package and prove it in the controlled demo before publishing to npm. Keep only project key, API location, and presentation options in its public API. Do not create unused packages or a framework-agnostic implementation in the MVP.

**Why:** The demo can expose integration, style isolation, accessibility, and API problems before the package becomes a public compatibility promise.

**Consequence:** Package exports, peer dependencies, styling delivery, and naming are finalized during the npm preparation phase after an installation test in a separate app.

## ADR-008 — Questions are routed, not auto-answered in MVP

**Decision:** Accept and classify questions into the support queue, but do not generate or deliver visitor-facing answers during the first complete MVP. Keep a separate generative-provider contract for a future owner-reviewed answer feature.

**Why:** Reliable source-backed answers and a reply channel require product and safety work beyond the GitHub triage journey. A confirmation is the MVP visitor response.

## ADR-009 — Webpack for Phase 1 Next.js scripts

**Decision:** Use Next.js 16's supported `--webpack` option for both app development and production builds until the Turbopack PostCSS worker can run reliably in the development environment. Keep the code and configuration compatible with the default bundler where possible. [Next.js CLI options](https://nextjs.org/docs/app/api-reference/cli/next)

**Why:** The platform app's Tailwind/PostCSS import causes the default Turbopack build to fail while its worker binds a local port (`Operation not permitted`), including in an escalated run. The same app builds successfully with `next build --webpack`. A foundation phase needs a reproducible `pnpm build` and `pnpm dev`; this is a tooling workaround, not a product or domain redesign.

**Consequence:** Re-test Turbopack in a normal development/CI environment before removing the flag. Do not add custom Webpack configuration merely because this flag is present.

## ADR-010 — Domain values as constrained text

**Decision:** Store ticket type, severity, route, ticket status, message role, integration/issue state, and webhook processing state as `text` columns with named PostgreSQL `CHECK` constraints. Export the corresponding TypeScript value sets from `packages/db`.

**Why:** These are product concepts, not provider concepts. Named checks preserve database enforcement while allowing new values through ordinary reviewed migrations without PostgreSQL enum replacement steps. Do not rely on Drizzle TypeScript unions alone for integrity.

## ADR-011 — UUID identifiers, references, and lifecycle

**Decision:** Use PostgreSQL-generated UUIDv4 primary keys for domain records and a separate `BIGSERIAL` ticket number for display as `SUP-<number>`. IDs are internal; the sequential reference grants no access. Use `timestamptz` for all recorded times. Default foreign keys to `RESTRICT` rather than cascading project, ticket, or audit deletion; explicit retention/deletion workflows come later.

**Why:** UUID defaults are simple, available in the local PostgreSQL version, and safe across distributed writers. Ticket numbers are for humans, not entity identity. Restrictive deletes protect support and audit history from accidental loss.

## ADR-012 — GitHub issue intent and future aggregation

**Decision:** Allow a `github_issues` row to exist before GitHub assigns its remote ID. It records a unique ticket linkage, immutable reconciliation marker, target repository, and a pending/reconciliation state; remote issue fields become complete together after a confirmed create or lookup. The MVP has one issue per ticket and one ticket per issue. A later aggregation phase can add a ticket-to-issue join table and migrate existing links without replacing the remote issue identity.

**Why:** Persisting the marker and target before the remote call lets a lost response be reconciled without blind duplicate creation. Null remote fields represent a real pending intent, not a fake GitHub issue.

## ADR-013 — Local PostgreSQL and integration tests

**Decision:** Use a single PostgreSQL 16 Alpine Docker Compose service for local development, with separate development and test databases initialized in one disposable volume. Use the same major version in GitHub Actions. Integration tests require an explicit `DATABASE_URL_TEST` ending in `_test`, apply checked-in migrations, and clean only that isolated database. Unit tests remain database-free.

**Why:** PostgreSQL constraints and transactions are material to this phase, so SQLite would give misleading results. Docker is already available locally and avoids a production provider dependency. Keeping unit and database tests separate preserves a fast default `pnpm test`.

## ADR-014 — Append-only classifications with explicit ordering

**Decision:** Keep every accepted classification as a separate row and assign it a database-generated monotonic classification number. The current classification is the highest number for a ticket; `Ticket.route` is a materialized workflow route updated in the same transaction. Only validated/policy-normalized decisions are stored, with source `model`, `manual`, `fallback`, or development `fixture`.

**Why:** A timestamp alone can tie within a transaction and does not identify the latest decision reliably. The number is internal ordering, not a public ID. Historical rows make later corrections and provider comparisons auditable without overwriting a prior decision.

## ADR-015 — Shadow DOM styles and a submission client boundary

**Decision:** The internal React widget uses a ShadowRoot and bundles its CSS text with its JavaScript entry, injecting one style element per widget instance. Consumers need no Tailwind configuration or separate stylesheet. A required `SupportSubmissionClient` supplies submissions in Phase 3; the demo provides a mock, and Phase 4 adds an HTTP adapter. The public component accepts only project key, position, theme, visible categories, title, and default-open options.

**Why:** Arbitrary host CSS can change controls, typography, and box sizing. Shadow DOM provides strong style isolation with a small package boundary and no iframe messaging or host build requirements. An adapter makes failure/retry behavior testable without implementing the API ahead of its phase. A bundled style string makes external installation straightforward, though it may be revisited during package hardening if bundle size or content-security policies require an external CSS asset.

**Consequence:** The host must allow inline styles under its Content Security Policy for this first version. Phase 11 must test a strict CSP consumer and choose a compatible stylesheet or nonce strategy before npm publication. The browser key remains public identification and the demo reference is fake. React and React DOM are peers; the package does not depend on Next.js, the database, or platform secrets.

## ADR-016 — Narrow support contracts and database-backed ingestion limits

**Decision:** Share only the stable public submission request/response/error Zod schemas through a narrow `packages/support-contracts` package imported by both the widget and the API. Enforce the per-project hourly ingestion quota (120 submissions) with an atomic upsert on a `submission_rate_limits` table rather than in-memory state, and compute the retry fingerprint server-side as versioned SHA-256 over normalized category, message, and contact content. Keep route handlers limited to HTTP concerns; the `support-ingestion` application service owns project resolution, origin comparison, quota, fingerprinting, and the transactional write.

**Why:** A small shared schema package keeps the widget/API contract identical without a generic types barrel or server imports in browser code. An in-memory limiter would misreport quota across serverless instances; a database row per project/hour is correct under concurrency and stores no client IP. Server-computed fingerprints keep retry comparison trustworthy because browser input is untrusted.

**Consequence:** `packages/support-contracts` must stay limited to cross-boundary contracts; database, AI, and GitHub types stay out. Quota tuning is a policy change, not a schema change. The fingerprint version prefix allows future input changes without silent collisions.

## ADR-017 — Provider-neutral AI triage with deterministic policy

**Decision:** Put the classifier boundary in `packages/ai`: a `TicketClassifier` interface, Zod input/result schemas, a `JevTicketClassifier` adapter over one `systemOne` call (type + severity choices), a deterministic `FixtureTicketClassifier` test double, and a `triageTicket` application service that persists through the existing `appendClassification` transaction. Route and GitHub eligibility are derived by deterministic policy code (`routeForType`, `evaluateGitHubEscalation`, 0.90 threshold in `config.ts`), never trusted model fields. Triage runs explicitly via `pnpm ai:triage`, never inside the ingestion request; failures record `triage_failed` and keep tickets in `needs_triage`.

**Why:** Jev supplies bounded judgment; code owns routing, thresholds, and side effects, so a future provider swaps behind the same interface. Explicit invocation keeps ticket acceptance independent of Jev with no queue infrastructure; SDK-internal retries plus manual re-triage bound the retry behavior. Storing eligibility as `githubIssueRecommended` prepares Phase 7 without performing any GitHub call.

**Consequence:** `packages/ai` core never imports the database (the service takes a narrow repository port; only the CLI wires the real repository). Low-confidence results still route with an audit reason; the owner review surface arrives with the Phase 6 dashboard. Reclassification appends history; concurrent runs converge via the existing guarded transition.

## Open operational inputs

- TypeSafe/Jev account access is needed for a valid-key live classification run in a later phase; transport and 401 mapping were verified with a dummy key in Phase 5.
- A disposable GitHub repository and GitHub App registration are needed in Phase 7; never use the portfolio repository as the initial test target.
- Hosting, managed PostgreSQL provider, and worker scheduling details are chosen before deployment. The application contracts above do not depend on a specific provider.
