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

**Amendment (live journey review):** Browser tests use their own local `_e2e` database and their own servers on 3100/3101 with a separate Next output directory, mock GitHub, and blank provider credentials. Reusing the development server and database let E2E tickets reach a live-configured app, and one was later published to the disposable repository. Development data now stays separate from automated browser data.

## ADR-014 — Append-only classifications with explicit ordering

**Decision:** Keep every accepted classification as a separate row and assign it a database-generated monotonic classification number. The current classification is the highest number for a ticket; `Ticket.route` is a materialized workflow route updated in the same transaction. Only validated/policy-normalized decisions are stored, with source `model`, `manual`, `fallback`, or development `fixture`.

**Why:** A timestamp alone can tie within a transaction and does not identify the latest decision reliably. The number is internal ordering, not a public ID. Historical rows make later corrections and provider comparisons auditable without overwriting a prior decision.

## ADR-015 — Shadow DOM styles and a submission client boundary

**Decision:** The internal React widget uses a ShadowRoot and bundles its CSS text with its JavaScript entry, injecting one style element per widget instance. Consumers need no Tailwind configuration or separate stylesheet. A required `SupportSubmissionClient` supplies submissions in Phase 3; the demo provides a mock, and Phase 4 adds an HTTP adapter. The public component accepts only project key, position, theme, visible categories, title, and default-open options.

**Why:** Arbitrary host CSS can change controls, typography, and box sizing. Shadow DOM provides strong style isolation with a small package boundary and no iframe messaging or host build requirements. An adapter makes failure/retry behavior testable without implementing the API ahead of its phase. A bundled style string makes external installation straightforward, though it may be revisited during package hardening if bundle size or content-security policies require an external CSS asset.

**Consequence:** The host must allow inline styles under its Content Security Policy for this first version. Phase 11 must test a strict CSP consumer and choose a compatible stylesheet or nonce strategy before npm publication. **Amendment (Phase 11):** styles are adopted as a constructable stylesheet, which strict `style-src` policies do not block, with a `<style>` fallback for browsers without `adoptedStyleSheets`; no nonce prop or separate CSS file is needed. A strict-CSP external consumer test enforces zero violations. The browser key remains public identification and the demo reference is fake. React and React DOM are peers; the package does not depend on Next.js, the database, or platform secrets.

## ADR-016 — Narrow support contracts and database-backed ingestion limits

**Decision:** Share only the stable public submission request/response/error Zod schemas through a narrow `packages/support-contracts` package imported by both the widget and the API. Enforce the per-project hourly ingestion quota (120 submissions) with an atomic upsert on a `submission_rate_limits` table rather than in-memory state, and compute the retry fingerprint server-side as versioned SHA-256 over normalized category, message, and contact content. Keep route handlers limited to HTTP concerns; the `support-ingestion` application service owns project resolution, origin comparison, quota, fingerprinting, and the transactional write.

**Why:** A small shared schema package keeps the widget/API contract identical without a generic types barrel or server imports in browser code. An in-memory limiter would misreport quota across serverless instances; a database row per project/hour is correct under concurrency and stores no client IP. Server-computed fingerprints keep retry comparison trustworthy because browser input is untrusted.

**Consequence:** `packages/support-contracts` must stay limited to cross-boundary contracts; database, AI, and GitHub types stay out. **Amendment (Phase 11):** the contracts expose a dependency-free `./constants` entry (categories, error codes, limits, patterns) that the widget bundles, while the Zod schemas built from those constants remain for the server. The browser widget no longer imports Zod: its eval-support probe is reported by strict-CSP hosts. A parity test proves widget checks and server schemas agree. Quota tuning is a policy change, not a schema change. The fingerprint version prefix allows future input changes without silent collisions.

## ADR-017 — Provider-neutral AI triage with deterministic policy

**Decision:** Put the classifier boundary in `packages/ai`: a `TicketClassifier` interface, Zod input/result schemas, a `JevTicketClassifier` adapter over one `systemOne` call (type + severity choices), a deterministic `FixtureTicketClassifier` test double, and a `triageTicket` application service that persists through the existing `appendClassification` transaction. Route and GitHub eligibility are derived by deterministic policy code (`routeForType`, `evaluateGitHubEscalation`, 0.90 threshold in `config.ts`), never trusted model fields. Triage runs explicitly via `pnpm ai:triage`, never inside the ingestion request; failures record `triage_failed` and keep tickets in `needs_triage`.

**Why:** Jev supplies bounded judgment; code owns routing, thresholds, and side effects, so a future provider swaps behind the same interface. Explicit invocation keeps ticket acceptance independent of Jev with no queue infrastructure; SDK-internal retries plus manual re-triage bound the retry behavior. Storing eligibility as `githubIssueRecommended` prepares Phase 7 without performing any GitHub call.

**Consequence:** `packages/ai` core never imports the database (the service takes a narrow repository port; only the CLI wires the real repository). Low-confidence results still route with an audit reason; the owner review surface arrives with the Phase 6 dashboard. Reclassification appends history; concurrent runs converge via the existing guarded transition.

## ADR-018 — Dashboard auth and human review

**Decision:** Implement ADR-002 with Better Auth email/password (minimum 12 characters, no email verification until delivery exists, no OAuth): canonical `user`/`session`/`account`/`verification` tables plus `workspace_members`, session cookies, and a seeded owner via `auth:bootstrap`. Gate public sign-up endpoints at the auth route (404 unless `AUTH_ALLOW_SIGNUP=true`). Scope every dashboard query and mutation by workspace membership with 404-equivalence for unknown/foreign IDs. Store human decisions in `ticket_overrides` (author, route/status/escalation, reason) with workflow-state application and audit events; never rewrite AI rows. Mutate through JSON route handlers (not server actions) with Origin-vs-host CSRF checks and Zod bodies. No `needs_review` status: review need is derived from confidence floor and triage-failure state.

**Why:** Email/password needs no external provider setup for local development while staying a maintained, non-custom credential path. Membership plus scoped queries gives tenant isolation without inventing authz. A separate override table preserves AI-vs-human provenance that workflow columns alone cannot. Route handlers keep mutation transport explicit and directly testable.

**Consequence:** Production must set `BETTER_AUTH_SECRET`, enable email verification with delivery, rotate the dev placeholder, and review the signup gate before any hosted use. Escalation-state transitions stay reserved for Phase 7.

## ADR-019 — Operator-confirmed GitHub escalation

**Decision:** Escalate through a GitHub App (`@octokit/app` pinned at 16.1.4, Issues read/write + Metadata read-only) with operator preview/confirm in the dashboard — no automatic creation yet. Keep a `packages/github` boundary (App client, deterministic drafts, privacy gate, escalation service with repository/tracker ports, scripted mock). Content is deterministic (no generative model): bounded title, structured body with a stable `<!-- ai-support-ticket:SUP-n -->` marker, labels intersected with existing repository labels. Reserve the intent row, reconcile by marker before every create, mark timeouts `needs_reconciliation`, and never blind-retry. Human decline always wins; ticket status is unchanged by creation.

**Why:** Operator confirmation lets the team validate content, privacy filtering, labels, and repository mapping before any automation. Deterministic drafts keep the security boundary verifiable. Reconcile-first plus database uniqueness converges retries and double-clicks without remote duplicates. Short-lived installation tokens stay in SDK memory, never in rows or browser code.

**Consequence:** Live use needs `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY` and a disposable-repo-first policy; `GITHUB_ESCALATION_MOCK=1` fakes only the network in E2E. Webhook sync arrives in Phase 8; escalation workflow statuses remain unused while Phase 7 issues leave tickets queued.

## ADR-020 — Transactional inbound GitHub state sync

**Decision:** Accept GitHub App webhook deliveries at unauthenticated `POST /api/webhooks/github`, authenticated by `X-Hub-Signature-256` over the exact bounded raw body. Require `X-GitHub-Delivery` and validate a minimal `issues` envelope. Persist only safe delivery metadata. Insert the unique delivery row and process linked issue, ticket, and events in one PostgreSQL transaction with issue/ticket row locks. Match repository ID + issue ID, issue number, and App installation against the active project integration. Handle `closed` and `reopened`; acknowledge `ping` and other actions without content synchronization.

**Why:** Database uniqueness and locks cover concurrent delivery and semantic repeats across instances. Event history already gives sufficient provenance: only tickets whose latest status decision is `ticket_resolved_from_github` auto-reopen. A manual status change takes precedence. The common workflow guard rejects impossible transitions. No new table, migration, or webhook payload archive is needed.

**Consequence:** A transient failure rolls back and returns 503. GitHub does not automatically redeliver failures, so operational redelivery is required. Distinct out-of-order events are a known limitation pending a reliable remote-state reconciliation strategy. The 1 MiB cap and synchronous work must be monitored against GitHub's 10-second response target. No comments, metadata edits, customer notifications, or marker-only linking are implemented.

## ADR-021 — Exclusive GitHub creation and trusted reconciliation

**Decision:** Add a `creating` issue-intent state and atomically claim it before any GitHub call. Only the claimant may reconcile or create. Keep ambiguous outcomes in `needs_reconciliation`; a missing reconciliation hit cannot start another create. Confirmation is conditional on a null remote ID. Derive an opaque marker from the private random ticket UUID, and reconcile only an exact standalone marker on a non-PR issue authored by this App bot after verifying the repository ID with the installation token. Read effective human decisions field-by-field by monotonic `decision_number` and use the materialized ticket route. Order ticket status provenance by monotonic `event_number` and ignore review-only `rerouted` events. The privacy gate blocks sensitive URLs, phone-shaped numbers, and JWTs; visitor Markdown is fenced.

**Why:** A unique intent row alone does not serialize remote creation. A response timeout or process crash cannot prove whether GitHub created the issue. Sequential references do not authenticate a reconciliation candidate. Partial override rows and timestamp ties do not reliably express latest human intent or resolution provenance.

**Consequence:** Migration `0004` adds `creating` to the GitHub issue check constraints; migration `0005` adds ordered audit numbers. A crash in `creating` requires operator reconciliation rather than automatic re-creation. Live App bot identity still needs disposable-repository verification. Existing confirmed links remain valid; old unconfirmed markers can be searched only with the strict App-author check. See [the review](docs/reviews/phase-08-grok-review.md) for deferred findings.

## ADR-022 — Escalation needs model or human provenance

**Decision:** GitHub preview and escalation require the current classification to come from a `model` or `manual` source, or an owner override that recommends escalation. `fixture` and `fallback` classifications block with `GITHUB_NOT_ELIGIBLE` unless a caller opts into `allowFixtureClassifications`, which only fully synthetic mock paths do (non-production `GITHUB_ESCALATION_MOCK=1`, the mock CLI, and tests).

**Why:** The live journey's first issue was published from a fixture decision. Fixture confidence is a deterministic stand-in, not evidence, and the numeric threshold alone could not tell the difference (Phase 8 review item 7). An owner override keeps a deliberate human path without rewriting AI history.

**Consequence:** Seeded and fixture-triaged tickets show a provenance block on real App configurations until re-triaged with Jev or recommended by an owner. The live runner records an owner recommendation when it uses fixture triage.

## ADR-023 — Remote ordering watermark and post-link state sync

**Decision:** Persist the newest applied GitHub `issue.updated_at` on the issue link and ignore older deliveries as stale. After confirming a link, read the issue's current state once and apply it through the same policy and locks as a webhook, without recording a delivery.

**Why:** Distinct deliveries can arrive out of order, and a close within seconds of creation can arrive before the link exists (Phase 8 review item 5). A timestamp from the provider orders events without a fresh read on every webhook; one read after linking closes the pre-link gap.

**Consequence:** Migration `0006` adds a nullable column; links without a timestamp accept the next event. One-second precision means same-second events keep arrival order. The post-link read costs one API call and fails open (the link stands).

## ADR-024 — Owner-only publishing and required Origin

**Decision:** Dashboard mutations require a same-origin `Origin` header. GitHub creation/reconciliation and review overrides require the workspace owner role; members may view, preview, re-triage, and change ticket status. Production startup refuses example or weak secrets, a non-HTTPS auth URL, the mock escalation flag, and self-signup without email verification. Email verification and a delivery provider are deferred to the deployment phase.

**Why:** Publishing to a public repository and overriding AI decisions are the highest-impact actions. `SameSite=Lax` cookies alone depend on browser policy. The live validation found example credentials behind a public tunnel.

**Consequence:** Scripts calling dashboard routes must send `Origin`. Member invitations still need an implementation before a second member exists; the gates are in place for it.

## ADR-025 — Retention by explicit command

**Decision:** Retention runs as `pnpm db:retention`, dry run by default: erase contact details 180 days after resolution (a `contact_details_erased` event records it) and delete terminal webhook delivery rows after 90 days (minimum 7). Reports, classifications, and PII-free events are kept.

**Why:** Contact details have no use after a ticket is closed for months; webhook rows are only needed for deduplication inside GitHub's redelivery window. A command avoids adding a scheduler before hosting is chosen.

**Consequence:** The deployment phase schedules the command. Resolution time is approximated by `tickets.updated_at`, so later edits postpone (never hasten) erasure.

## ADR-026 — Publish only the widget, from a verified tarball

**Decision:** Publish `packages/widget` as `@issuerelay/widget` (MIT, npm org `issuerelay` owned by the personal `andrewbaisden` account), starting at `0.1.0`. Keep every other package private under `@ai-support-platform/*`. Publish exactly the tarball that `pnpm test:package` verified. The first version is published manually; later versions publish from `widget-v*` tags through npm trusted publishing (GitHub OIDC) with provenance, so no npm token is stored.

**Why:** Consumers need only the browser widget; platform code is not a library. Verifying the tarball, rather than the workspace, is what catches private dependencies, missing files, and server code. Trusted publishing removes a long-lived secret and records where each release was built.

**Consequence:** The product is branded IssueRelay (repository `andrewbaisden/issuerelay`). Internal package names are unchanged. Trusted publishing is configured after the first publish. Versions below 1.0 may change the API in minor releases.

## ADR-027 — Vercel, Neon, and Resend deployment

**Decision:** Host `apps/web` on Vercel (project `issuerelay-web`, root `apps/web`) with Neon PostgreSQL from the Vercel Marketplace and Resend for account email. Production builds apply reviewed migrations over the direct connection before building; previews never migrate. The runtime uses Neon's pooled URL with `DATABASE_POOL_MAX=2`. Retention runs as a daily Vercel Cron authenticated by `CRON_SECRET`. Account email goes through an `EmailSender` port with a fetch-based Resend adapter and is enabled only when both `RESEND_API_KEY` and `EMAIL_FROM` are set; it then requires verified email to sign in and offers password reset. Production owners, workspaces, and projects come from `pnpm setup:production`, never the demo seed.

**Why:** Vercel runs Next.js route handlers, crons, and HTTPS without extra infrastructure. Neon replaced Vercel Postgres. Vercel withholds sensitive variables from local pulls, so migrating inside production builds keeps credentials off developer machines and ships schema changes with their code. A port keeps the email provider replaceable and testable without network access.

**Consequence:** Migrations must stay additive so rollbacks remain compatible. The GitHub App has one webhook URL, now production; local webhook tests need a separate development App. Preview deployments share production variables unless a Neon preview branch is configured.

## ADR-028 — Self-hosting: setup token, settings page, and a manifest-built GitHub App

**Decision:** Anyone can run their own IssueRelay from a Deploy to Vercel button (whole repository, Root Directory `apps/web`, the Neon store, and three prompted secrets). A first-run `/setup` page creates the owner, workspace, and first project through the same `bootstrapInstallation` service as `pnpm setup:production`. It works only while the database has no accounts **and** `SETUP_TOKEN` (32+ characters, compared in constant time) is set; requests must be same-origin, and it returns 404 otherwise. Owner-only project settings replace allowed origins and connect a repository: the server finds the App's installation for `owner/name` with the App JWT and takes the repository ID and canonical name from GitHub, never from the request. `pnpm github:create-app` registers the App from a manifest (Issues read/write, Metadata read, the Issues event, webhook URL preset) and writes its credentials to a git-ignored file. `BETTER_AUTH_URL` falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL`.

**Why:** Self-hosting removes every CLI step and database access from first-time setup, while each piece keeps the existing trust rules: a freshly deployed URL is public, so claiming it needs a secret only the deployer holds; repository identity comes from GitHub as in `verifyRepository`; and the manifest sets the Issues subscription that was missed by hand during live validation.

**Consequence:** One App serves one deployment. Setup closes permanently after the first account; recovering a lost owner still needs `pnpm setup:production` or database access. A project connects to one repository, and disconnecting stays an operator task. In practice GitHub issues need Jev (`TYPESAFE_API_KEY`): the offline fixture classifier is a keyword test double whose fallback (`other`, 0.62) cannot reach the 0.9 bug threshold, and an owner recommendation cannot raise confidence, so the guide treats the key as required for escalation. Hosted multi-tenant IssueRelay (public sign-up, invitations, billing) remains future work.

## Open operational inputs

- TypeSafe/Jev account access is needed for a valid-key live classification run in a later phase; transport and 401 mapping were verified with a dummy key in Phase 5.
- The disposable repository `andrewbaisden/ai-support-platform-live-test` and GitHub App `ai-support-platform-dev` validated the live journey; never use the portfolio repository as a test target.
- Deployment (2026-09-28): Vercel, Neon, and Resend are in production (ADR-027). Still open: a custom domain, member invitations, and a Neon preview branch.
