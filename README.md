# AI Support Platform

A developer-focused support platform for websites and applications. An embeddable widget accepts visitor requests; the platform creates durable tickets, classifies them, routes them to the right queue, and escalates eligible bugs to GitHub. GitHub issue changes flow back to the linked ticket.

This repository is in **Phase 0: product and architecture specification**. There is no runnable application yet. The architecture is documented in [ARCHITECTURE.md](ARCHITECTURE.md); implementation decisions and their reasons are in [DECISIONS.md](DECISIONS.md).

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

## Planned repository layout

```text
apps/web/                 Platform UI and API
apps/demo/                Controlled widget consumer
packages/widget/          Internal embeddable React widget
packages/db/              PostgreSQL schema, migrations, repositories
packages/ai/              Classifier and generation interfaces/adapters
packages/github/          GitHub App adapter and issue mapping
docs/handoffs/            Phase handoffs
```

Packages will be added only when a phase needs them. The initial stack is Node.js, pnpm, Next.js 16 App Router, strict TypeScript, PostgreSQL, Drizzle, Better Auth when dashboard access is introduced, Tailwind CSS, shadcn/ui, React Hook Form, Zod, Vitest, React Testing Library, and Playwright. TanStack Query is reserved for dashboard server state where it helps; Zustand is not planned.

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

Local setup, screenshots, a live demo, and package installation instructions will be added when those capabilities exist.
