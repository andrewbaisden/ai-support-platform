# Phase 10 handoff — production hardening

Owner-approved on 2026-09-28, with three decisions:

- **Roles:** publishing is owner-only.
- **Email:** verification is deferred to deployment, with a production guard.
- **Retention:** a configurable purge CLI.

The strict-CSP widget test and the license decision stay with Phases 11–12 (ADR-015, roadmap). No new integrations, queues, or product features were added.

## Delivered

For each change the regression test was written first and seen failing, except where noted in the last column.

| Change | Gap closed | Regression test |
| --- | --- | --- |
| Required same-origin `Origin` on dashboard mutations | A POST without `Origin` skipped the CSRF check (Phase 8 review item 11) | `apps/web/lib/dashboard-api.test.ts`; E2E boundary spec (Origin-less requests refused before any session lookup) |
| Owner-only publishing and overrides; members see no publishing controls | Members and owners shared all powers (item 14) | `dashboard-api.test.ts` (member → `OWNER_REQUIRED` 403); GitHub `route.test.ts` (preview needs no owner role, create does) |
| Strict post-login redirect helper shared by server and client | `/\evil.example` (browser-normalized to `//evil.example`), encoded slashes, tabs, non-dashboard, and oversized paths were accepted (item 12) | `apps/web/lib/callback-url.test.ts`: 11 bypass shapes failed before the fix |
| Webhook ordering watermark (`remote_updated_at`, migration `0006`) | Delayed older deliveries could roll state back (Phase 8 known issue) | `webhook.test.ts` (stale ignored, same-second arrival order, watermark advance); PostgreSQL journey test |
| Post-link state sync (`getIssueState` → `applyIssueEvent` under `withGitHubIssueSync`) | A close delivered before the link existed was lost (item 5) | Journey tests: early close resolves the ticket without a delivery row; a failed state read keeps the link |
| Shared per-process pool (`getSharedDatabase`, `DATABASE_POOL_MAX`) | Three pools of 10 per process (item 10) | `packages/db/src/client.test.ts` |
| Production startup guard (`instrumentation.ts`) | Example credentials were found behind a public tunnel | `production-config.test.ts`. Verified against real servers: `next start` refused an `http://` auth URL (HTTP 500, setting named, no secret in the log) and served normally with an `https://` URL |
| Security headers (`frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, referrer and permissions policies, HSTS in production) | None were set | `security-headers.test.ts`; E2E header check on `/login` |
| `pnpm db:retention` (dry run unless `--apply`) | Contact details and delivery rows were kept forever | `packages/db/src/retention.test.ts` (cutoffs, dry run, audit event, idempotency, terminal-only deletes) |

One defect was introduced and fixed during the phase. The first `instrumentation.ts` returned early and then imported the database package. Webpack still compiled that import into the edge bundle, so the running `next dev` server returned 500 ("Can't resolve 'fs'") until the check moved into `instrumentation-node.ts` behind the documented `NEXT_RUNTIME === "nodejs"` condition. The earlier `next build` + `next start` check had not exercised `next dev`. Afterwards, the dev server, a production start, and E2E were all checked.

## Verification

| Command | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed (after replacing a control-character regex that Biome rejects) |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 143 tests, 22 files |
| `pnpm test:db` | Passed: 22, 5 files |
| `pnpm test:ai` | Passed: 6 |
| `pnpm test:github` | Passed: 17 |
| `pnpm ai:evaluate` | Passed: 7/7 |
| `pnpm db:check` | Passed |
| `pnpm build` | Passed |
| `pnpm test:e2e` | 18 tests. The first full run had one failure: the Origin check now precedes the session check, so an anonymous Origin-less request returns `FORBIDDEN`, not `UNAUTHENTICATED`. The spec now sends `Origin` for the session case and asserts both. The targeted rerun and the final full run passed: **18/18** on 3100/3101 beside the running dev server. |
| `pnpm db:retention` (dev DB) | Dry run: 0 contacts, 0 deliveries; `--webhook-days 3` refused |
| `pnpm audit` | 1 moderate (`esbuild` via `better-auth → drizzle-kit`, development serve mode only); accepted, see SECURITY.md |
| `pnpm db:migrate` (dev DB) | Applied `0006` |
| `LIVE_GITHUB_TEST=1 pnpm github:live-journey --repository andrewbaisden/ai-support-platform-live-test` | **20/20 passed** (SUP-337 → issue #11). The post-link state read on a real issue added no events. `remote_updated_at` holds GitHub's real `updated_at`. Real deliveries: `closed` ×2 and `reopened` processed; `opened` and `labeled` ignored. Finished closed. |

## Known issues and deferred work

- Email verification, password reset, and a delivery provider: deployment phase (ADR-024). Signup is refused in production until then.
- `pnpm db:retention` is not scheduled; the deployment phase schedules it. Resolution time uses `tickets.updated_at`.
- Member invitations do not exist yet; the role gates are ready for them.
- Hosting, TLS termination, secret storage, and monitoring of 401/503 webhook rates remain deployment inputs.
- Same-second GitHub events are ordered by arrival.
- The Octokit REST version used for issue create/update is scheduled for removal on 2028-03-10.
- Strict-CSP widget consumer test and license decision: Phases 11–12.

## Exact Phase 11 starting point

After owner approval: validate `packages/widget` as an external package. Pack it, install it into a separate consumer outside the workspace, test a strict-CSP host (choose a stylesheet or nonce strategy per ADR-015), and finalize exports, peer dependencies, and naming. Do not publish to npm until Phase 12 and a license decision.
