# AI Support Platform

A developer-focused support platform for websites and applications. An embeddable widget accepts visitor requests; the platform creates durable tickets, classifies them, routes them to the right queue, and escalates eligible bugs to GitHub. GitHub issue changes flow back to the linked ticket.

This repository has completed **Phase 7: GitHub issue escalation**. Operators confirm eligible tickets in the dashboard to create real GitHub issues via a GitHub App (mock adapter in tests/E2E); linkage, events, privacy gating, and idempotent reconciliation are implemented. No webhooks or generative AI exist yet. The architecture is documented in [ARCHITECTURE.md](ARCHITECTURE.md); implementation decisions and their reasons are in [DECISIONS.md](DECISIONS.md).

## MVP journey

1. A visitor on any configured project opens the widget and submits a question, bug report, or feature request. Name and email are optional.
2. The public API validates the request and stores its conversation, first message, and ticket before attempting any external work.
3. A bounded classifier proposes a type, severity, and confidence. Application policy routes questions to support, feature requests to product, spam to quarantine, and eligible bugs to engineering.
4. A high-confidence, privacy-safe engineering bug connected to a GitHub repository becomes an issue. Otherwise it stays in the dashboard for owner review.
5. Signed GitHub issue webhooks synchronize the linked issue and ticket. Closing an issue can resolve the engineering ticket; reopening it reopens the ticket.

The first live dashboard is for one owner. The data model still separates workspaces and projects so another website can use the same platform without sharing its tickets or repository connection.

## MVP and non-goals

The MVP includes an internal React widget, demo consumer, public ticket API, owner dashboard, Jev-backed classification, GitHub App escalation, signed webhook synchronization, and offline tests. Questions are captured and routed; automatic AI answers and customer reply delivery are later work. The widget will be prepared for npm publication but will not be published until its external API is stable.

The MVP excludes billing, subscriptions, public signup, knowledge-base ingestion, complex RAG, email or chat integrations, autonomous support agents, advanced duplicate detection, analytics, and the portfolio deployment. See [ARCHITECTURE.md](ARCHITECTURE.md#deferred-work) for the later roadmap.

## Repository layout

```text
apps/web/                 Platform app shell, public ticket API, and operator dashboard
apps/demo/                Controlled consumer app shell (mock or real API mode)
packages/auth/            Better Auth instance, session/membership helpers, owner bootstrap
packages/ai/              Provider-neutral triage: classifier interface, Jev adapter, fixture classifier, policy, triage service, CLIs
packages/db/              Drizzle schema, migrations, seed, scoped repository
packages/github/          GitHub App client, deterministic issue drafts, privacy gate, escalation service, mock adapter, CLIs
packages/widget/          React support widget, HTTP submission client, bundled styles
packages/support-contracts/ Narrow public submission request/response/error schemas
e2e/                      Browser smoke, widget, and ingestion flows
.github/workflows/ci.yml  Repository verification
docs/handoffs/            Phase handoffs
```

AI, GitHub, and dashboard packages arrive with their phases: `packages/ai` owns triage, `packages/auth` owns dashboard access, and `packages/github` now owns escalation. The current stack is Node.js 24, pnpm 11, Next.js 16 App Router, React 19, strict TypeScript, PostgreSQL 16, Drizzle, Biome, Tailwind CSS in the platform shell, React Hook Form, Zod, Vitest, React Testing Library, Playwright, the official `@typesafe-ai/sdk` (server-only triage use), and the official `@octokit/app` SDK (server-only GitHub use). Better Auth, shadcn/ui, and TanStack Query arrive only when their features need them; Zustand is not planned.

## Local development

Use Node.js 24 (`.node-version`) and the pnpm version declared in `package.json`. The app shells require no database to start. For database commands, copy `.env.example` to ignored `.env`; the example values are local-only Docker credentials. Do not commit `.env` files or production secrets.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The platform shell runs at `http://127.0.0.1:3000`; the demo runs at `http://127.0.0.1:3001`. `pnpm dev:web` and `pnpm dev:demo` run them individually.

The demo exercises the internal widget with light/dark/system themes, left/right positioning, and a mock failure toggle. Its submission-mode control selects a local mock (default, no database) or the real local API. Real mode posts through `HttpSupportSubmissionClient` to the platform app and shows the returned `SUP-<number>` reference. The package builds before the demo starts and exports compiled JavaScript and TypeScript declarations.

```tsx
import {
  HttpSupportSubmissionClient,
  SupportWidget,
} from "@ai-support-platform/widget";

const submissionClient = new HttpSupportSubmissionClient({
  apiBaseUrl: "https://api.support-platform.example",
});

<SupportWidget projectKey="pk_..." submissionClient={submissionClient} />;
```

A plain `SupportSubmissionClient` object (for example `{ submit: async () => ({ reference: "SUP-DEMO-001" }) }`) still works for deterministic UI development. The widget supports `position`, `theme`, `categories`, `title`, and `defaultOpen`. Its styles are bundled into the component and injected into a Shadow DOM, so consumers need no stylesheet or Tailwind configuration. The project key is public identification, not authorization. Mock references are visibly fake and create no backend ticket.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm format` applies Biome formatting. `pnpm test:e2e` needs Playwright Chromium; install it with `pnpm exec playwright install chromium` if absent. It builds the shared packages once, then serves both apps (`pnpm dev:e2e`); the ingestion specs additionally need a migrated and seeded development database (`pnpm db:migrate && pnpm db:seed`) because they submit through the real API. Both apps use Next.js 16's supported Webpack option because Turbopack's PostCSS worker could not bind a local port in the Phase 1 development environment; see [DECISIONS.md](DECISIONS.md).

## Public ticket ingestion (Phase 4)

`POST /api/v1/support/tickets` accepts `{ projectKey, category, message, contact?, submissionId }` as JSON (16 KB body limit) and returns `{ ticketReference: "SUP-<number>", status: "received" }`. The server resolves the project from `projectKey`, checks the browser `Origin` against the project's allowed origins, validates with Zod, applies a per-project hourly rate limit, and creates Conversation, visitor Message, Ticket (`needs_triage` with the visitor category stored only as `categoryHint`), and a `submitted` event in one transaction. Retrying the same `submissionId` with identical content returns the same reference; the same key with different content is a `409` conflict. No AI, GitHub, authentication, or background worker is involved. Request/response/error schemas live in `packages/support-contracts`, shared by the API and the widget's `HttpSupportSubmissionClient`; the widget never imports database, server, AI, or GitHub types. See [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and `docs/handoffs/phase-04.md` for the contract, idempotency, origin/CORS, and rate-limit details.

## Operator dashboard (Phase 6)

Sign in at `/login` with the seeded owner account (`SEED_OWNER_EMAIL`, local only), then open `/dashboard` for per-project ticket counts, filterable ticket tables (`?status=&route=&type=&severity=&q=SUP-123&page=`), and ticket detail with the visitor report, current AI classification, append-only history, timeline, and human review decisions. Operators can re-run triage, record route/status/escalation overrides with authorship and reason, resolve/reopen tickets, and release quarantine — all validated and workspace-scoped server-side. AI rows are never rewritten; overrides live in `ticket_overrides` with the deciding owner. Confidence renders as a spread-based model score with an explicit non-calibration note and a below-floor review badge.

`BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are required server-only env (see `.env.example`); public self-signup is disabled at the auth route unless `AUTH_ALLOW_SIGNUP=true`. The public ingestion API is unchanged and needs no authentication.

## AI triage (Phase 5)

`pnpm ai:triage --pending` classifies `needs_triage` tickets (or `--ticket <uuid>` for one) with the mock fixture classifier by default; `--classifier jev` uses live Jev and requires `TYPESAFE_API_KEY`. Each decision persists a `TicketClassification` row with type, severity, policy route, GitHub-escalation recommendation, confidence, and provenance, and moves the ticket to `queued` (bugs to `engineering`, questions to `support`, features to `product`) or `quarantined` (spam). Visitor contact details are never sent to Jev — only the message and category hint. `pnpm ai:evaluate` runs the versioned fixture set (mock must pass 7/7; live only reports observations). Triage never blocks ingestion: the public API is unchanged and accepted tickets survive provider failures in `needs_triage` with a `triage_failed` event. See [AI_ENGINEERING.md](AI_ENGINEERING.md) and `docs/handoffs/phase-05.md`.

Set `NEXT_PUBLIC_SUPPORT_API_URL` (documented in `.env.example`) when the demo or an external consumer must target a non-default API base URL; same-origin/local defaults apply otherwise. `DATABASE_URL` stays server-only.

## GitHub issue escalation (Phase 7)

Eligible tickets (`bug` + `engineering` + confidence ≥ 0.90 + human recommendation standing) show a GitHub section on the detail page with the target repository, a deterministic issue preview (title, Markdown body, labels, correlation marker), and a confirm button. Creation mints a short-lived installation token via the GitHub App, posts `POST /repos/{owner}/{repo}/issues`, persists the linkage (`github_issues`: remote ID, number, URL, `open`), and records timeline events — without changing ticket status. Retries and double-clicks reconcile by marker first and never blind-retry; timeouts mark `needs_reconciliation`. A deterministic privacy gate blocks emails, keys, tokens, credentials, and card numbers for human review. No generative AI is involved.

Connect a project with `pnpm github:connect` (GitHub App with Issues read/write + Metadata read, installed on a disposable repository first); create from the dashboard or `pnpm github:escalate --ticket <uuid>` (mock by default, `--live` needs `GITHUB_APP_ID`/`GITHUB_APP_PRIVATE_KEY`). `GITHUB_ESCALATION_MOCK=1` fakes only the GitHub network for E2E. See [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and `docs/handoffs/phase-07.md`.

## Local PostgreSQL

Docker Compose starts only PostgreSQL 16 and creates separate development and test databases. Port `54339` is bound to loopback, with a persistent Compose volume. Docker is optional for developers who provide equivalent local PostgreSQL URLs.

```sh
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm test:db
pnpm db:down
```

`pnpm db:down` preserves the volume. `pnpm db:generate` creates a versioned migration after an intentional schema change; review and commit its SQL and snapshot. `pnpm db:check` checks migration history. `pnpm db:studio` starts Drizzle Studio for local inspection. Never use schema push as the deployment path. The seed is repeatable and creates one workspace, two projects, and eight sample tickets (question, bugs incl. low-confidence, feature, spam, failed triage, reclassified, resolved) without AI or GitHub calls, then bootstraps the local owner account and workspace ownership when `SEED_OWNER_EMAIL`/`SEED_OWNER_PASSWORD` are set.

`pnpm test` remains database-free; `pnpm test:db` migrates and clears only the separate local `*_test` database. The test runner rejects a nonlocal or non-test URL. GitHub Actions starts PostgreSQL 16 and runs the same database suite after the unit checks.

## Development phases

| Phase | Outcome |
| --- | --- |
| 0 | Product specification, architecture, decisions, security, test plan, agent instructions |
| 1–2 | Monorepo foundation, domain model, migrations, seed data |
| 3–4 | Internal widget, demo consumer, ticket ingestion API |
| 5–6 | AI triage, owner dashboard |
| 7–9 | GitHub escalation, webhook sync, complete demo journey |
| 10–12 | Hardening, external package validation, npm publication |
| 13–15 | Portfolio integration, dogfooding, technical article |

Each phase stops with a handoff in `docs/handoffs/`. Phase 8 begins only after review of the Phase 7 handoff.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): domain, flows, state, packages, reliability, roadmap.
- [DECISIONS.md](DECISIONS.md): recorded architectural choices and tradeoffs.
- [AI_ENGINEERING.md](AI_ENGINEERING.md): model responsibilities, validation, fallback, evaluation.
- [SECURITY.md](SECURITY.md): trust boundaries and required controls.
- [TESTING.md](TESTING.md): fixtures, testing layers, and phase gates.
- [AGENTS.md](AGENTS.md): implementation rules for future coding agents.

Screenshots, a live demo, and package installation instructions will be added when those capabilities exist.
