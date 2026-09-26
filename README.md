# AI Support Platform

A developer-focused support platform for websites and applications. An embeddable widget accepts visitor requests; the platform creates durable tickets, classifies them, routes them to the right queue, and escalates eligible bugs to GitHub. GitHub issue changes flow back to the linked ticket.

This repository has completed **Phase 3: internal support widget**. The demo uses a local mock submission client; ticket ingestion HTTP endpoints and live product workflows are not implemented yet. The architecture is documented in [ARCHITECTURE.md](ARCHITECTURE.md); implementation decisions and their reasons are in [DECISIONS.md](DECISIONS.md).

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
apps/web/                 Platform app shell; future UI and API
apps/demo/                Controlled consumer app shell
packages/db/              Drizzle schema, migrations, seed, scoped repository
packages/widget/          Internal React support widget and bundled styles
e2e/                      Browser smoke and widget flows
.github/workflows/ci.yml  Repository verification
docs/handoffs/            Phase handoffs
```

AI and GitHub packages will be created when their phases need them. The current stack is Node.js 24, pnpm 11, Next.js 16 App Router, React 19, strict TypeScript, PostgreSQL 16, Drizzle, Biome, Tailwind CSS in the platform shell, React Hook Form, Zod, Vitest, React Testing Library, and Playwright. Better Auth, shadcn/ui, and TanStack Query arrive only when their features need them; Zustand is not planned.

## Local development

Use Node.js 24 (`.node-version`) and the pnpm version declared in `package.json`. The app shells require no database to start. For database commands, copy `.env.example` to ignored `.env`; the example values are local-only Docker credentials. Do not commit `.env` files or production secrets.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The platform shell runs at `http://127.0.0.1:3000`; the demo runs at `http://127.0.0.1:3001`. `pnpm dev:web` and `pnpm dev:demo` run them individually.

The demo exercises the internal widget with light/dark/system themes, left/right positioning, and a mock failure toggle. It sends no ticket to the backend. The package builds before the demo starts and exports compiled JavaScript and TypeScript declarations.

```tsx
import { SupportWidget, type SupportSubmissionClient } from "@ai-support-platform/widget";

const submissionClient: SupportSubmissionClient = {
  async submit(_input) {
    // Supply a local mock in Phase 3; the public API adapter arrives in Phase 4.
    return { reference: "SUP-DEMO-001" };
  },
};

<SupportWidget projectKey="pk_..." submissionClient={submissionClient} />;
```

The widget supports `position`, `theme`, `categories`, `title`, and `defaultOpen`. Its styles are bundled into the component and injected into a Shadow DOM, so consumers need no stylesheet or Tailwind configuration. The project key is public identification, not authorization. Demo references are visibly fake and no backend ticket is created.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm format` applies Biome formatting. `pnpm test:e2e` needs Playwright Chromium; install it with `pnpm exec playwright install chromium` if absent. Both apps use Next.js 16's supported Webpack option because Turbopack's PostCSS worker could not bind a local port in the Phase 1 development environment; see [DECISIONS.md](DECISIONS.md).

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

`pnpm db:down` preserves the volume. `pnpm db:generate` creates a versioned migration after an intentional schema change; review and commit its SQL and snapshot. `pnpm db:check` checks migration history. `pnpm db:studio` starts Drizzle Studio for local inspection. Never use schema push as the deployment path. The seed is repeatable and creates one workspace, two projects, and four sample tickets without AI or GitHub calls.

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

Each phase stops with a handoff in `docs/handoffs/`. Phase 4 begins only after review of the Phase 3 handoff.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): domain, flows, state, packages, reliability, roadmap.
- [DECISIONS.md](DECISIONS.md): recorded architectural choices and tradeoffs.
- [AI_ENGINEERING.md](AI_ENGINEERING.md): model responsibilities, validation, fallback, evaluation.
- [SECURITY.md](SECURITY.md): trust boundaries and required controls.
- [TESTING.md](TESTING.md): fixtures, testing layers, and phase gates.
- [AGENTS.md](AGENTS.md): implementation rules for future coding agents.

Screenshots, a live demo, and package installation instructions will be added when those capabilities exist.
