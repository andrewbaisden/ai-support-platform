# AI Support Platform

A developer-focused support platform for websites and applications. An embeddable widget accepts visitor requests; the platform creates durable tickets, classifies them, routes them to the right queue, and escalates eligible bugs to GitHub. GitHub issue changes flow back to the linked ticket.

This repository has completed **Phase 1: repository foundation**. The two Next.js application shells, workspace tooling, CI, and smoke tests run locally. Product workflows are not implemented yet. The architecture is documented in [ARCHITECTURE.md](ARCHITECTURE.md); implementation decisions and their reasons are in [DECISIONS.md](DECISIONS.md).

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
e2e/                      Browser smoke checks
.github/workflows/ci.yml  Repository verification
docs/handoffs/            Phase handoffs
```

`packages/` does not exist yet. Widget, database, AI, and GitHub packages will be created when their phases need them. The current stack is Node.js 24, pnpm 11, Next.js 16 App Router, React 19, strict TypeScript, Biome, Tailwind CSS in the platform shell, Zod for server environment validation, Vitest, React Testing Library, and Playwright. Drizzle, Better Auth, shadcn/ui, React Hook Form, and TanStack Query arrive only when their features need them; Zustand is not planned.

## Local development

Use Node.js 24 (`.node-version`) and the pnpm version declared in `package.json`. The repository requires no custom environment variables yet; `.env.example` documents the rule for adding them. Do not commit `.env` files or secrets.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The platform shell runs at `http://127.0.0.1:3000`; the demo runs at `http://127.0.0.1:3001`. `pnpm dev:web` and `pnpm dev:demo` run them individually.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm format` applies Biome formatting. `pnpm test:e2e` needs Playwright Chromium; install it with `pnpm exec playwright install chromium` if absent. Both apps use Next.js 16's supported Webpack option because Turbopack's PostCSS worker could not bind a local port in the Phase 1 development environment; see [DECISIONS.md](DECISIONS.md).

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

Each phase stops with a handoff in `docs/handoffs/`. Phase 1 starts only after review of this specification.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): domain, flows, state, packages, reliability, roadmap.
- [DECISIONS.md](DECISIONS.md): recorded architectural choices and tradeoffs.
- [AI_ENGINEERING.md](AI_ENGINEERING.md): model responsibilities, validation, fallback, evaluation.
- [SECURITY.md](SECURITY.md): trust boundaries and required controls.
- [TESTING.md](TESTING.md): fixtures, testing layers, and phase gates.
- [AGENTS.md](AGENTS.md): implementation rules for future coding agents.

Screenshots, a live demo, and package installation instructions will be added when those capabilities exist.
