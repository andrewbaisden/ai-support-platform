# Agent instructions

This repository is an AI support platform with a reusable website widget. Read `README.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `AI_ENGINEERING.md`, `SECURITY.md`, `TESTING.md`, and the latest `docs/handoffs/` file before changing architecture. The current repository has completed Phase 1; do not start Phase 2 until the owner approves it. Each app also has Next.js-generated `AGENTS.md` guidance; read the relevant installed Next.js docs before changing framework code.

## Coding and package rules

- Use Node.js, pnpm, strict TypeScript, and kebab-case filenames except framework-required names. Avoid `any`; document a genuinely unavoidable use.
- Keep direction `UI → application services → domain/adapters → infrastructure`. React components must not call GitHub, Jev, or the database directly. Keep the widget free of server-only imports and secrets.
- Use Zod at public API, environment, provider output, and webhook payload boundaries. TypeScript types are not runtime validation.
- Use Drizzle for PostgreSQL and reviewed migrations. Do not introduce Prisma. Use Better Auth when protected dashboard access becomes necessary; keep workspace authorization in application code.
- Add packages only for concrete phase needs. Use Biome as the default formatter/linter, adding ESLint only if a specific ecosystem check cannot be covered. Do not add Zustand, Redis/BullMQ, monitoring, or extra integrations without evidence and an ADR.
- Use Conventional Commits. Do not mix phases into a single change. A phase stops with a report and handoff.

## Current commands

Use Node.js 24 and pnpm 11.5.3. Run `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` from the root. `pnpm test:e2e` runs Chromium smoke tests against both local app shells. `pnpm format` applies Biome formatting. No custom environment variables are required in Phase 1; add only implemented variables to `.env.example` and the server-side Zod schema. Both app scripts currently use Next.js `--webpack` as recorded in ADR-009. CI runs install, lint, typecheck, test, and build.

## Invariants

- Persist an accepted ticket before external AI or GitHub calls. Provider failure must not erase it.
- The widget project key is public identification, not authentication. Browser code never contains database, GitHub, TypeSafe, or generative-provider secrets.
- Tenant/project ownership is checked on every protected operation. A GitHub webhook updates only an issue linked to the matching installation and repository.
- Jev makes bounded recommendations; deterministic code owns policy and side effects. Validate normalized AI output and keep low-confidence cases in review.
- Never publish contact data, secrets, or raw private conversations to GitHub. Generated issue content passes the same publication checks as deterministic content.
- Ticket submission, work retries, issue creation, and webhook processing require documented idempotency and recovery. Do not blindly retry an ambiguous GitHub issue creation.

## Workflow

Before a phase, inspect current repository state and latest handoff. Make the smallest complete change for that phase. Update architecture and ADRs if behavior or boundaries change. Run relevant tests, typecheck, lint, and build checks that exist. Record commands and actual results, known issues, deferred work, and next-phase instructions in `docs/handoffs/phase-XX.md`. Never report an unrun check as passing. Use a disposable GitHub repository for integration testing before connecting a production repository.

Phase 2 starts with the Drizzle/PostgreSQL domain model and migrations after a separate approval. npm publication and portfolio installation require their later phases.
