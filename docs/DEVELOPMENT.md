# Development guide

This page holds the setup and implementation detail moved out of the public-facing [README](../README.md). It describes the repository as implemented through Phase 10. Use [ARCHITECTURE.md](../ARCHITECTURE.md) for domain and state rules, [SECURITY.md](../SECURITY.md) for trust boundaries, and [TESTING.md](../TESTING.md) for fixtures and gates.

## Requirements and local setup

- Node.js 24 (`.node-version`) and pnpm 11.5.3 (`package.json`).
- Docker Compose with PostgreSQL 16, or equivalent local development and separate test database URLs.
- Playwright Chromium only for browser tests.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`.env` is ignored. `DATABASE_URL` and `DATABASE_URL_TEST` in `.env.example` target the local Compose instance on loopback port `54339`; change them if using another PostgreSQL server. Before `pnpm db:seed`, uncomment and set `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` to bootstrap a dashboard owner. The seed is repeatable: it creates one workspace, two projects, and representative question, bug, feature, spam, triage-failure, reclassified, and resolved tickets without calling AI or GitHub. `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are server-only requirements for the platform app; the example secret and owner password are for local development only.

The platform runs at `http://127.0.0.1:3000` and the demo consumer at `http://127.0.0.1:3001`. Run `pnpm dev:web` or `pnpm dev:demo` for one app. The demo's mock mode works without database setup. Real mode posts through `HttpSupportSubmissionClient` to the platform API and shows its `SUP-<number>` reference. Set `NEXT_PUBLIC_SUPPORT_API_URL` when the demo must target a different API base URL; `DATABASE_URL` must never use the `NEXT_PUBLIC_` prefix.

## Repository layout

```text
apps/web/                 Platform UI, public ticket API, operator dashboard
apps/demo/                Standalone widget consumer and mock/real modes
packages/widget/          React widget, bundled Shadow DOM styles, HTTP client
packages/support-contracts/ Public request, response, and error schemas
packages/db/              Drizzle schema, migrations, seed, scoped repository
packages/ai/              Classifier port, Jev/fixture adapters, policy, triage
packages/auth/            Better Auth, session and membership helpers
packages/github/          GitHub App client, draft/privacy policy, workflow
e2e/                      Browser journeys
docs/handoffs/            Historical phase results and known limitations
```

The stack uses Next.js 16 App Router, React 19, strict TypeScript, PostgreSQL 16, Drizzle, Better Auth, Zod, React Hook Form, Biome, Vitest, React Testing Library, and Playwright. The platform uses Tailwind CSS; widget consumers do not need it. The AI and GitHub adapters use the official TypeSafe and Octokit App SDKs on the server. Both apps use Next.js `--webpack` as recorded in [ADR-009](../DECISIONS.md).

## Widget package

Consumers import only `@issuerelay/widget` (see [the widget README](../packages/widget/README.md) and [releasing](RELEASING.md)). The widget accepts a public `projectKey` and a `SupportSubmissionClient`; it also supports `position`, `theme`, `categories`, `title`, and `defaultOpen`. Styles are bundled into its Shadow DOM. `HttpSupportSubmissionClient` sends to the public API; a plain client object can keep UI work deterministic. The demo defaults to a local mock, can simulate failure, and marks mock references as fake. The package is not published to npm.

## Public ingestion

`POST /api/v1/support/tickets` accepts `{ projectKey, category, message, contact?, submissionId }` as JSON and returns `{ ticketReference: "SUP-<number>", status: "received" }`. The API caps request bodies at 16 KB, resolves the project from the public key, checks allowed browser origins, validates with Zod, and applies a per-project hourly rate limit. In one transaction it stores a conversation, visitor message, ticket in `needs_triage`, and `submitted` event. An identical retry returns the same reference; reused submission ID with different content returns `409`. No AI or GitHub call happens in this request. Cross-boundary schemas live in `packages/support-contracts`.

## Dashboard and triage

Sign in at `/login` with the seeded owner, then open `/dashboard` for project counts, ticket filters, and detail. The detail page shows visitor report, classification history, timeline, GitHub state, and human decisions. Operators can re-run triage, override route/status/escalation recommendation, resolve or reopen a ticket, and release quarantine. Mutations check the session, workspace membership, origin, payload, and workflow transition. Classifications remain append-only; human decisions live separately in `ticket_overrides` with author and reason.

`pnpm ai:triage --pending` classifies development tickets with the fixture classifier by default; use `--ticket <uuid>` for one ticket. `--classifier jev` uses live Jev and requires server-only `TYPESAFE_API_KEY`. Jev receives only the message and category hint. Application policy maps bugs to engineering, questions to support, features to product, and spam to quarantine. `pnpm ai:evaluate` runs versioned fixtures (7/7 required for the mock; live Jev is observation-only). A provider failure leaves the already accepted ticket in `needs_triage` for retry.

## GitHub integration

Connect a project with `pnpm github:connect` using a GitHub App with Issues read/write and Metadata read permission, installed on a disposable repository first. Eligible queued engineering bugs show a deterministic issue preview. Explicit operator confirmation creates through the App, after an atomic `creating` claim and repository identity check. Privacy screening blocks detected sensitive content; an opaque marker and strict App-author check support reconciliation without blindly repeating ambiguous issue creation. Creation does not change ticket status. `pnpm github:escalate --ticket <uuid>` uses the mock by default; `--live` needs server-only `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` and must use a disposable repository.

Configure the App webhook URL as `https://<platform-host>/api/webhooks/github`, subscribe to repository **Issues**, and set the same high-entropy signing secret in GitHub and server-only `GITHUB_WEBHOOK_SECRET`. The endpoint is authenticated by raw-body HMAC, not a dashboard session. It handles `issues.closed`, `issues.reopened`, and setup `ping`; unrelated actions are acknowledged. Delivery IDs are deduplicated in PostgreSQL. A close can resolve a queued engineering ticket; a reopen can restore a ticket whose latest resolution came from GitHub. No issue content, comments, or customer notifications sync. GitHub [does not automatically redeliver failed webhooks](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries); inspect Recent Deliveries and redeliver failures manually. The [Phase 8 handoff](handoffs/phase-08.md) records local and opt-in live validation.

Before using a public tunnel for webhook validation, replace the example dashboard owner password and `BETTER_AUTH_SECRET`. The tunnel also exposes `/login`; it is not a webhook-only surface. `GITHUB_ESCALATION_MOCK=1` is for local E2E and is ignored under `NODE_ENV=production`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev`, `pnpm build` | Run both apps or build shared packages and apps |
| `pnpm lint`, `pnpm format`, `pnpm typecheck` | Biome checks/format and strict TypeScript checks |
| `pnpm test`, `pnpm test:db` | Database-free unit tests and isolated PostgreSQL integration tests |
| `pnpm test:ai`, `pnpm test:github` | Database-backed AI and GitHub integration suites |
| `pnpm test:e2e` | Chromium journeys through both apps; needs migrated, seeded dev DB for ingestion/dashboard specs |
| `pnpm db:generate`, `pnpm db:check`, `pnpm db:migrate` | Generate and review SQL, check migration history, apply migrations |
| `pnpm db:seed`, `pnpm db:studio`, `pnpm db:down` | Seed local data, inspect locally, stop Compose without deleting its volume |

Install Chromium with `pnpm exec playwright install chromium` if it is missing. `pnpm test:db` uses only a separate local database whose name ends in `_test`; the runner refuses a nonlocal or development URL. Schema changes use reviewed migrations, never a production schema push. CI runs unit, migration, database, AI, GitHub, evaluation, and build checks against PostgreSQL 16; browser tests are a separate local gate.
