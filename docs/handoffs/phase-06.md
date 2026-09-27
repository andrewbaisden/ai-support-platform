# Phase 6 handoff — support dashboard and human review

## Completed

- Implemented ADR-002 with Better Auth 1.7.6 email/password (12-char minimum, no verification until delivery exists, no OAuth, no custom password code) in new `packages/auth` (instance, session/membership helpers, `/client` browser entry, `auth:bootstrap` CLI). Canonical `user`/`session`/`account`/`verification` tables plus `workspace_members` and `ticket_overrides` ship in migration `0003`.
- Added dashboard reads as Next.js server components over workspace-scoped repository queries: `/dashboard` (projects + per-status counts), `/dashboard/projects/[projectId]/tickets` (status/route/type/severity/reference filters, pagination, all URL-addressable), and ticket detail (report, contact, current classification, history, timeline, override, actions). Contact details render only on detail pages.
- Mutations are JSON route handlers (`retriage`, `status`, `override`) with session, membership, Origin-vs-host CSRF, Zod, and transition checks — chosen over server actions for explicit HTTP semantics after debugging showed equivalent UI code failing opaquely. Re-triage appends history via the Phase 5 service (Jev when keyed, fixture otherwise); resolve/reopen enforce `canTransition`; overrides store author/reason separately and never rewrite AI rows. No `needs_review` status: review need derives from the 0.50 floor badge and triage-failure state.
- Login at `/login` through the real form (no bypass); public sign-up endpoints 404 unless `AUTH_ALLOW_SIGNUP=true`; unauthenticated dashboard access redirects with validated relative callback URLs; routes are `force-dynamic`.
- Extended seed to eight tickets (low-confidence bug, failed triage, reclassified, resolved) and chained owner bootstrap into `pnpm db:seed`.
- Updated README, ARCHITECTURE, DECISIONS (ADR-018), AGENTS, SECURITY, TESTING, AI_ENGINEERING, `.env.example`, and CI-adjacent docs.

## Dashboard routes

`/login`, `/dashboard`, `/dashboard/projects/[projectId]/tickets`, `/dashboard/projects/[projectId]/tickets/[ticketId]`, `/api/auth/[...all]` (signup-gated), `/api/dashboard/tickets/[ticketId]/{retriage,status,override}`.

## Authentication choice

Better Auth (pre-decided ADR-002), email/password only. Single-owner bootstrap via seed; membership-gated workspaces. Production must set `BETTER_AUTH_SECRET`, enable verification, and review the signup gate.

## Authorization model

Session → `workspace_members` → workspace → projects → tickets. Every query/mutation resolves project→workspace and asserts membership; unknown/foreign IDs 404 without leaking existence. Contact data and override authorship stay behind these checks.

## Ticket list/detail behavior

Server-rendered tables with filters/pagination; detail shows message, hint, contact, current AI decision with non-calibrated confidence note, full history with current marker, timeline events, human override card with author, and GitHub recommendation labeled as recommendation only.

## Human review/override model

`ticket_overrides(decided_by FK user, route?, status?, github?, reason≤500)` + workflow-state application + `rerouted`/`released_from_quarantine` events. Resolve/reopen via `updateTicketStatus` with `resolved`/`reopened` events. Escalation states reserved for Phase 7.

## Re-triage behavior

Operator action records `retriage_requested`, then forced `triageTicket` (Jev if `TYPESAFE_API_KEY`, else fixture); failures surface safe codes, successes refresh history. Page rendering never depends on Jev.

## Confidence presentation

Value plus "spread-based model score, not a calibrated probability" caption; below-floor values carry a "Needs review" badge.

## Test results

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed; 105+ files |
| `pnpm typecheck` | Passed (tooling, contracts, widget, apps, db, ai, auth) |
| `pnpm test` | Passed (incl. filter/transition suites) |
| `pnpm test:db` | Passed: 13 cases (7 existing + 6 dashboard: scoping, filters/pagination/latest-selection, history ordering, override provenance, resolve/reopen, isolation) |
| `pnpm test:ai` | Passed: 6 triage cases, no regression |
| `pnpm ai:evaluate` | Passed: 7/7 |
| `pnpm build` | Passed |
| `pnpm test:e2e` | Passed: 10 Chromium cases (incl. 4 dashboard: login→inspect, re-triage→history, resolve→timeline, unauthenticated→login) |
| `git diff --check` | Passed |
| Manual curl | retriage/resolve/override succeed; no-cookie 401; forged-origin 403; invalid transition rejected |

## Schema/migration changes

`0003`: `user`, `session`, `account`, `verification` (Better Auth canonical shapes), `workspace_members` (unique workspace+user, owner/member), `ticket_overrides` (composite ticket FK, author FK, decision/route/status checks, reason length). No ingestion/AI contract changes.

## Deviations

- ADR-018 records auth implementation, override model, route-handler mutations, and review derivation.
- Tailwind-only dashboard (no shadcn): tables/forms don't justify a component-library dependency yet; revisit if the UI grows.
- Mutations via route handlers instead of server actions (§21 allows either): explicit requests/responses made auth, CSRF, and failure behavior directly testable.
- Fixed E2E-only issues found while verifying: client components must import `@ai-support-platform/auth/client` (package root bundles Node-only pg), and detail clicks wait for `networkidle` (pre-hydration clicks never reach React in dev).

## Known issues

- Email verification off; dev secret placeholder; signup gate is route-level — review all three before hosted use.
- `AUTH_ALLOW_SIGNUP` defaults closed; owner management UI deferred.
- Dashboard E2E uses documented local seed credentials.
- No GitHub connection display yet (Phase 7); escalation states unreachable manually by design.

## Exact Phase 7 starting point

After owner approval, implement the GitHub App integration against `githubIssueRecommended` tickets: project integration records, issue-intent persistence with reconciliation markers, eligible-bug issue creation, and signed webhook handling — tested against a disposable repository, never the portfolio repo. Dashboard already surfaces eligibility; add connection state and issue links there.
