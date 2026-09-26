# Phase 1 handoff — repository foundation

## Completed

- Created a pnpm 11 workspace pinned to Node.js 24 with two private Next.js 16 / React 19 App Router applications: the platform shell and the controlled demo consumer shell.
- Added shared strict TypeScript options, per-app type generation/checks, and a separate root tooling typecheck.
- Added Biome formatting/linting, Tailwind CSS only in the platform shell, Zod validation of its current server environment, a documented `.env.example`, and secret-safe ignore rules.
- Set up Vitest with React Testing Library, Playwright browser smoke coverage for both apps, and GitHub Actions install/lint/typecheck/test/build checks.
- Updated README, architecture, decisions, agent instructions, and testing documentation with actual commands and the Webpack tooling decision.

## Final repository structure

```text
apps/web/                  Main Next.js app shell, env validation, Tailwind, RTL smoke test
apps/demo/                 Independent Next.js consumer shell with plain CSS
e2e/                      Playwright shell smoke test
.github/workflows/ci.yml   CI verification
docs/handoffs/             Phase handoffs
biome.json                 Lint and formatting
playwright.config.ts       Browser test servers and configuration
vitest.config.ts           Unit/component test configuration
tsconfig.base.json         Shared strict TypeScript options
tsconfig.tooling.json      Root tooling typecheck
pnpm-workspace.yaml        App and future package workspace globs
pnpm-lock.yaml             Reproducible pnpm dependency resolution
```

There is no `packages/` directory yet. The widget, database, AI, and GitHub packages remain for their respective phases. Each app contains Next.js-generated `AGENTS.md` and `CLAUDE.md` guidance; Next regenerates these on `next dev` if absent.

## Important tooling choices

- Node.js 24 is pinned in `.node-version`; pnpm 11.5.3 is pinned in `package.json`. Current resolved Next.js is 16.3.6.
- Both apps use Next.js `--webpack` for dev/build. The default Turbopack build failed while its PostCSS worker attempted to bind a local port; the supported Webpack build passed. This is recorded in ADR-009. Re-evaluate Turbopack in a normal environment before removing the flag.
- Biome is the only linter/formatter. ESLint, Prettier, Husky, and lint-staged were not added because no current requirement justifies them.
- No custom environment variable is required. `apps/web/env.ts` validates the current `NODE_ENV` boundary with Zod, and future variables should be added only with the feature that uses them.
- Playwright remains a separate local gate rather than a CI step until browser product flows make the runner cost worthwhile.

## Commands and verification

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile up to date |
| `pnpm dev` | Passed; both apps reported ready on ports 3000 and 3001 |
| `pnpm lint` | Passed; Biome checked 24 files |
| `pnpm typecheck` | Passed; tooling and both apps |
| `pnpm test` | Passed; 1 component smoke test |
| `pnpm build` | Passed; both production shells built with Webpack |
| `pnpm test:e2e` | Passed; 1 Chromium test reached both shells |
| `git diff --check` | Passed; no whitespace errors |

`pnpm test:e2e` required unsandboxed local server/browser access in this development environment. No external service was used. CI has been configured but has not run on GitHub because the phase is uncommitted.

## Architecture changes

No product, domain, tenant, AI, or GitHub architecture changed. ADR-009 records the temporary Next.js bundler choice. The demo remains a standalone consumer app shell and does not import platform server code.

## Known issues and deferred work

- Turbopack/PostCSS local worker cannot bind a port in this environment; Webpack scripts are the documented workaround.
- The CI workflow has only been inspected locally; its first GitHub run will occur after a future commit/push.
- The current unit and browser checks cover app-shell wiring only. Product behavior tests begin with later phases.
- No database, domain model, auth, widget, ticket, AI, GitHub integration, dashboard, webhook, or publication work was added.

## Unresolved decisions

The concrete Phase 2 table shape, key constraints, migration naming, and development PostgreSQL instance remain to be decided while implementing the documented domain model. Hosting, scheduler, provider credentials, and GitHub test repository are later operational inputs.

## Exact starting point for Phase 2

After owner approval, add the `packages/db` boundary with Drizzle and PostgreSQL, refine only the minimum domain tables from `ARCHITECTURE.md`, create reviewed migrations and realistic seed data, and test relationships plus cross-workspace isolation. Do not add auth or product API flows ahead of their phases. Run the available root checks, update ADRs if implementation forces a genuine change, and write `docs/handoffs/phase-02.md` before stopping.
