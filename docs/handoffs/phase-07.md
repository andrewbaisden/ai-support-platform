# Phase 7 handoff — GitHub issue escalation

## Completed

- Created `packages/github` (`@ai-support-platform/github`, source-exported): `IssueTracker`/`TrackerFactory` ports, `GithubError` taxonomy with request mapping, deterministic draft builder, privacy gate, `escalateTicketToGitHub` service with repository/tracker ports, side-effect-free `previewEscalation`, scripted mock adapter, and `github:connect` / `github:escalate` CLIs.
- Verified GitHub integration surface first: `POST /repos/{owner}/{repo}/issues` → 201 with `id`/`number`/`html_url`; labels silently dropped without push access (intersect strategy); minimum permissions Issues read/write + Metadata read-only; JWT + installation-token minting inside pinned `@octokit/app@16.1.4` (endpoint-style `request`, no hand-rolled signing; tokens held in SDK memory only).
- Added db reads/writes: `getIntegrationForProject`, `getGitHubIssueForTicket`, `confirmGitHubIssue` (https-github.com URL check), `markGitHubIssueStatus`; reused Phase 2 `connectGitHubRepository`/`reserveGitHubIssue`/unique constraints. No migration needed.
- Dashboard: GitHub section on ticket detail (not-configured / preview + confirm / linked / unknown-retry / blocked reasons), `POST /api/dashboard/tickets/[ticketId]/github` (`preview`|`create`) with session, membership, Origin, Zod checks; ticket status unchanged by creation. Seeded a mock-target integration on the portfolio project.
- Mock tracker IDs derive from the issue marker (stable per ticket, unique across tickets) after a real `github_issues_remote_unique` collision during verification proved the constraint fires.
- Updated README, ARCHITECTURE, DECISIONS (ADR-019), AGENTS, SECURITY, TESTING, `.env.example` (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_ESCALATION_MOCK`), CI (`test:github`), and Playwright env.

## GitHub App/SDK approach

`@octokit/app@16.1.4`; `App({appId, privateKey})` → `getInstallationOctokit(installationId)` → endpoint `request` calls with 10 s per-call timeouts. Live paths need `GITHUB_APP_ID` + `\n`-escaped PEM; normal checks never require them.

## Permissions

Issues read/write, Metadata read-only. No contents/admin/actions/PR/hooks. Phase 8 `issues` webhooks need no additional permissions.

## Integration configuration

`pnpm github:connect --project <uuid> --installation <id> --repository <id> --owner <o> --repo <r>` records the single project link (IDs from the App installation on the disposable repo). Seed carries a mock-target row for local/E2E.

## Escalation eligibility

Effective type bug + route engineering + standing recommendation + confidence ≥ 0.90 + status queued + active integration + privacy pass + no existing link. Human decline always wins. Recomputed at creation time, never trusted from stored flags alone.

## Human confirmation flow

Preview (target repo, title, body, candidate labels, reasons) → explicit confirm → create → linked issue with validated `https://github.com` URL. Unknown outcomes offer reconcile-and-retry; linked tickets show the issue with no button.

## Issue draft/privacy model

`[SUP-n] Reported bug: <80-char excerpt>` title; structured body (summary, sanitized report ≤4000 chars, context with non-calibrated confidence note, workflow footer, marker comment); labels `bug` + `severity:high/critical` intersected with repo labels. Gate blocks emails, private keys, API tokens, credential assignments, card numbers (findings only, values never logged); anything found requires human review.

## Idempotency/reconciliation

Reserve intent → record requested → reconcile-by-marker search (3 pages) → create → confirm `open`. Timeouts → `needs_reconciliation`; failures → `retry_required`; repeats return linkage. Never blind-retry. `github_issues` unique ticket + remote constraints are the final arbiters; one ticket ↔ one issue preserved for future aggregation.

## GitHubIssue persistence

Remote ID, number, URL, `open` status, timestamps, reconciliation marker, integration link; ticket keeps its workflow status; `github_issue_created` (+`_requested`/`_failed`/`_unknown`/`_blocked`) events with safe summaries.

## Test results

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed; 133 files |
| `pnpm typecheck` | Passed (all packages + apps) |
| `pnpm test` | Passed: 70 tests / 14 files (incl. 22 new GitHub unit: privacy, draft, errors, service, preview) |
| `pnpm test:db` | Passed: 13 cases, no regression |
| `pnpm test:ai` | Passed: 6 cases, no regression |
| `pnpm test:github` | Passed: 5 escalation integration cases |
| `pnpm ai:evaluate` | Passed: 7/7 |
| `pnpm github:escalate` (mock) | Verified: created → URL → already-linked on repeat |
| `pnpm build` | Passed |
| `pnpm test:e2e` | Passed: 13 Chromium cases (incl. 3 new GitHub flows: preview→confirm→link, privacy block, already-linked) |
| `git diff --check` | Passed |

## Live GitHub validation status

Not run: no GitHub App credentials or disposable repository exist in this environment (verified). Setup is documented (`github:connect`, `--live` with explicit warnings). Live test must create one issue in the disposable repo and verify linkage before any portfolio use.

## Deviations

- ADR-019 records the App model, operator-confirmed flow, deterministic content, and reconciliation design.
- No auto-escalation (spec allowed gating it off; operator flow validates content first).
- Fixed E2E-only issues found while verifying: client components must import `@ai-support-platform/auth/client` (carried over), dotenv v18 logs via `console.error`, which Next.js dev surfaces as a blocking error overlay — `loadRootEnv` now passes `quiet: true`; detail clicks wait for `networkidle` and retry idempotently because pre-hydration clicks never reach React in dev.
- No issue editing in Phase 7 (spec optional; drafts are fixed snapshots).
- No ticket status change on creation (escalation exists ≠ resolved).
- GitHub Enterprise host validation deferred (`github.com` only, documented).

## Known issues

- 0.90 threshold still uncalibrated; live accuracy unknown.
- Mock IDs are marker-derived hashes (collisions astronomically unlikely, not impossible; production uses GitHub IDs).
- Reconciliation scans 3 pages of recent issues; very old unknowns may need manual lookup.
- Rate-limit retry guidance is surfaced, not automated.
- Dev DB carries mock-linked issues from verification (local-only).

## Exact Phase 8 starting point

After owner approval (and live disposable-repo validation), implement signed `issues` webhook intake: HMAC verification on raw bytes, delivery dedup, installation/repository/issue matching against stored links, and close/reopen mapping onto ticket status per the documented state flow — reusing `webhook_events`, `github_issues`, and ticket events. No generative AI.
