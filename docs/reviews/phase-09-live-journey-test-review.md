# Live journey test review — steps 5–15

Review and validation of the live acceptance journey (submit → triage → preview → confirmed GitHub issue → privacy/marker → close → resolve → reopen → timeline) against the implementation after commit `832fd6e`. Owner-approved test/review scope only: no new product features, no Phase 9 feature work, no publication or portfolio integration.

Two kinds of evidence are kept separate throughout:

- **AUTOMATED MOCK/LOCAL VALIDATION** — Vitest, PostgreSQL integration, and Playwright. Everything is real except GitHub's network, which the scripted mock tracker replaces.
- **REAL GITHUB VALIDATION** — GitHub App `ai-support-platform-dev` (App ID 5097495, installation 165479139) on the disposable repository `andrewbaisden/ai-support-platform-live-test` (ID 1390993615). Signed webhooks arrived through a Cloudflare quick tunnel to the local platform on `127.0.0.1:3000`.

## Coverage before this review

| Step | Existing coverage (before) | Gap |
| --- | --- | --- |
| 5 Submit | Widget component tests (contact, category, retry key); route contract with fake repo; DB atomic/concurrent submission; E2E demo→API with reference, idempotent retry | No browser run with contact data; no DB assertion of exactly one conversation/message/ticket; categoryHint vs classification only at AI level |
| 6 Triage | Service unit tests; DB triage (history, disagreement, failure, concurrency); Jev adapter sends only message+hint (stub transport) | Classifier input not asserted through the DB path with contact present; "no GitHub row from triage" not asserted |
| 7 Preview | Unit preview states; E2E preview visible | Preview side-effect-free (no events/rows) not asserted against DB; stale preview vs confirmation-time recomputation; disconnected integration via DB |
| 8 Create | Unit + DB create, repeat, concurrent confirm, timeout→reconcile, human decline | Clear-rejection→retry path at DB level; failure matrix (auth/rate/timeout/unavailable) only partially; App-client failure |
| 9 Privacy | Regex unit tests; E2E email block | Real credential formats untested; contact-name echo untested; internal IDs in body untested; audit/log non-leakage partially |
| 10 Marker | Unit marker stability; reconciliation identity (planted/PR/wrong author) | Stored marker vs published marker line; marker excludes raw UUID |
| 11–14 Webhook | Unit HMAC/schema/policy; DB transaction, rollback, dedupe, provenance; one E2E signed close/reopen | Real route rejection cases (modified body, wrong secret, missing/invalid delivery, malformed JSON, wrong repo/installation/number); late redelivery after reopen; human precedence at DB level |
| 15 Timeline | Scattered event assertions | Full ordered, deduplicated trail with PII check |
| Live | None (no credentials before this review) | Everything |

Only a mock covered: GitHub network behaviour (create/list/labels/verify), App bot identity, and webhook delivery transport.

## Tests added

| Suite | File | What it proves |
| --- | --- | --- |
| Unit | `packages/github/src/privacy.test.ts` | Real credential shapes (`ghs_`, `ghu_`, `sk_live_`, `sk_test_`, `sk-proj-`, Bearer), `token=`/`access_token:`/`auth-token=`/`API_KEY=` assignments, false-positive controls (versions, dates, "tokenizer", "password reset page"), submitted-contact echo, findings never contain values |
| Unit | `packages/github/src/preview.test.ts`, `escalation-service.test.ts` | Contact-echo block in preview and service (no reservation, no create, no name in events); create failure matrix (auth, permission, missing repo, rate limit → `retry_required`; timeout, outage → `needs_reconciliation`) with no create, no confirm, safe summaries, no console output; resumed ambiguous attempt never creates; App-client failure |
| Unit | `apps/web/lib/github-tracker.test.ts` | Mock only with explicit flag outside production; production ignores the mock flag and fails closed without App credentials; no silent fallback |
| Integration (PostgreSQL) | `packages/github/src/journey.integration-test.ts` (`pnpm test:github`) | One ticket through steps 5–15 with the real triage service, preview, escalation service, and webhook transaction. Also: hint/classifier disagreement, stale preview + resolved + disconnected at confirmation time, human resolution outranks GitHub, human reopen survives repeated close, rate-limit→retry creates once, credentials+name blocked before GitHub with clean audit trail |
| Browser | `e2e/support-journey.spec.ts` | Real widget with name/email → real API (request body and 201 asserted) → dashboard login → fixture re-triage → preview excludes contact/ticket ID → mock create → signed close, duplicate delivery, semantic repeat → resolved → signed reopen, late close replay → queued → ordered timeline without contact data |
| Browser | `e2e/github-boundaries.spec.ts` | Real webhook route: missing/wrong/stale signature 401, missing/non-UUID delivery 400, signed malformed JSON 400, other repo/installation/unknown issue/wrong number/schema-invalid 200 ignored, ticket untouched, genuine delivery then works. Dashboard GitHub route: 401 without session, forged Origin rejected, unknown project/ticket 404, public ingestion still credential-free |
| Live (opt-in) | `packages/github/src/cli/live-journey.ts` (`pnpm github:live-journey`) | Real App + disposable repo, steps 5–16 with PASS/FAIL per check (see below) |

Tests were not weakened. Existing E2E specs only changed their hard-coded URLs to the shared E2E constants.

## Steps 5–15 coverage matrix

Unit = Vitest without DB. DB = `packages/db` suite. Integration = PostgreSQL service-level suites (`test:github`, `test:ai`). Browser = Playwright with mock GitHub network. Live GitHub = real App/repository.

| Step | Behavior | Unit | DB | Integration | Browser | Live GitHub | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | Widget/API submission, one logical ticket, private contact, idempotent retry, conflict | ✅ | ✅ | ✅ | ✅ | ✅ (HTTP submit + retry, SUP-325/326) | Pass |
| 6 | Triage: history, route, provenance, hint separate, classifier sees message+hint only, no GitHub side effect | ✅ | — | ✅ | ✅ | ✅ fixture (SUP-325) and live Jev (SUP-326, confidence 1.00) | Pass |
| 7 | Preview: eligible only, repository, bounded title, model-score wording, labels, no side effects, blocks | ✅ | — | ✅ | ✅ | ✅ | Pass |
| 8 | Confirmed create once, linkage, URL, ticket unchanged, repeat reuses, concurrency, failures | ✅ | ✅ | ✅ | ✅ | ✅ create + repeat (#7, #8) | Pass. Concurrency and failure modes are mock/DB only |
| 9 | No contact, IDs, secrets in published issue; unsafe content blocked | ✅ | — | ✅ | ✅ | ✅ (#1, #7, #8 bodies inspected) | Pass after fixes D1/D2 |
| 10 | Opaque marker once; link matches repo/issue ID/number/integration; trusted App bot | ✅ | ✅ | ✅ | ✅ | ✅ author `ai-support-platform-dev[bot]` (Bot) | Pass |
| 11 | Signed close; forged/malformed/mismatched rejected; dedupe | ✅ | ✅ | ✅ | ✅ | ✅ real deliveries 200; forged cases not sent live | Pass |
| 12 | Close resolves queued engineering ticket with GitHub provenance; human precedence | ✅ | ✅ | ✅ | ✅ | ✅ (#1, #2, #7, #8) | Pass |
| 13 | Signed reopen; only GitHub-resolved tickets reopen | ✅ | ✅ | ✅ | ✅ | ✅ | Pass |
| 14 | Ticket back to queued; history and overrides untouched | ✅ | ✅ | ✅ | ✅ | ✅ | Pass |
| 15 | Ordered, deduplicated, PII-free timeline; redelivery no-op | — | ✅ | ✅ | ✅ | ✅ redelivery `duplicate`, events unchanged (#7, #8) | Pass |

## Defects found and production fixes

**D1 — Privacy gate missed real credential formats (step 9).** Failing regression tests first: `privacy.test.ts` showed that GitHub App installation tokens (`ghs_…`), user-to-server tokens (`ghu_…`), Stripe keys in their real underscore form (`sk_live_…`, `sk_test_…`), OpenAI-style keys (`sk-proj-…`), and `token=`/`access_token:`/`auth-token =` assignments all passed as safe. The existing pattern only knew `ghp_`/`gho_` and a hyphenated `sk-live-` form that providers do not issue. **Fix** (`packages/github/src/privacy.ts`): `gh[opusr]_`, `[sr]k[-_](live|test)[-_]`, `sk-(proj-)?` with length ≥ 20, and `(access|auth|refresh|session)?[_-]?token` assignments. The existing controls plus four new ordinary-text controls still pass. This is still a heuristic; it does not prove content safe.

**D2 — Visitor's own contact details could be published (step 9).** A report such as "Ada Tester here: …", from a visitor who submitted the name Ada Tester, produced an eligible preview containing that name. The draft never copies contact fields, but the gate never compared the report against them. **Fix**: `screenReport(message, { contact })` adds a `contact-detail` finding for the submitted email (case-insensitive) or the whole-phrase submitted name (≥ 3 characters). `PreviewTicket`/`EscalationTicket` now require `contact` (nullable), so every caller must supply it. The dashboard page, the GitHub route, the escalate CLI, and the live runner load it from the private conversation. The finding kind is logged; the value never is. Limitation: nicknames, partial names, and other people's names are not detected.

**D3 — The E2E harness could reach live GitHub and shared development data (test infrastructure).** Evidence:
- The earlier Playwright config reused any server already on :3000; during this validation that was the live-configured dev server.
- E2E tickets were written to the development database. SUP-275 ("E2E retriage probe …", created by an 08:20 UTC E2E run) was later escalated from the dashboard into the real repository as issue #5.
- With `TYPESAFE_API_KEY` in `.env`, dashboard re-triage in E2E called live Jev.

**Fix** (tests/tooling only):
- Playwright always starts its own servers on **3100/3101**, with its own Next output (`NEXT_DIST_DIR=.next-e2e`, which gets a separate Next 16 dev lock), so it runs beside `pnpm dev`.
- Browser tests use the isolated local `support_platform_e2e` database (`e2e/global-setup.ts`: create, migrate, seed, allow the E2E demo origin).
- The E2E servers get `GITHUB_ESCALATION_MOCK=1` and blank `GITHUB_APP_*`/`TYPESAFE_API_KEY`, so any unmocked path fails closed.
- App dev scripts honour `WEB_PORT`/`DEMO_PORT`, and `next.config.ts` honours `NEXT_DIST_DIR`. Defaults are unchanged.

Verified: a full E2E run added 0 tickets to the development DB and left the running dev server on 3000/3001 up.

No architectural defect was found in escalation, reconciliation, or webhook processing.

## Live GitHub validation (REAL GITHUB VALIDATION)

Run 2026-09-27/28 UTC. Tunnel `https://greensboro-til-freebsd-arabia.trycloudflare.com/api/webhooks/github`; App subscribed to Issues; permissions Issues write, Metadata read.

| Evidence | Result |
| --- | --- |
| Setup finding | The App was first registered with **no event subscriptions** (`events: []`); GitHub sent only `ping`. After the owner enabled Issues, deliveries flowed. The first quick-tunnel hostname later stopped resolving; the owner started a new tunnel and updated the App URL. |
| SUP-317 → #1, SUP-320 → #2 (owner, GitHub UI) | Close → `github_issue_closed` + `ticket_resolved_from_github`; reopen → `github_issue_reopened` + `ticket_reopened_from_github`. Deliveries 200. Contact present on the ticket and absent from issue #1. Author `ai-support-platform-dev[bot]`, type Bot, matching the reconciliation trust rule. |
| SUP-325 → #7 (`github:live-journey`, fixture triage) | Steps 5–14 PASS. The runner then stopped on two runner bugs (not product): delivery IDs above `Number.MAX_SAFE_INTEGER` were rounded by JSON parsing, and the issue listing check ran before GitHub's listing showed the new issue. Both are fixed in the runner. The remaining steps were completed manually with the same checks: GitHub redelivery of the close → HTTP 200 `{"outcome":"duplicate"}`, events 9→9, one `webhook_events` row; final close → resolved. No contact data in the audit trail. |
| SUP-326 → #8 (`github:live-journey --classifier jev`) | **19/19 checks PASS.** Jev: bug/engineering, confidence 1.00. Submit + idempotent retry, preview, create, repeat reuses link, no private data published, allowlisted labels, single marker, trusted bot author, single remote issue, close → resolved, reopen → queued, close redelivery a no-op (HTTP 200, events 8→8), ordered PII-free timeline, finished closed/resolved. |
| Drift repair #3–#6 | Closed on GitHub before the Issues subscription existed, so never delivered. Reopened and closed through the API; each now shows closed/resolved locally. |
| Final state | GitHub and local agree for all 8 issues (#1–#2 open/queued; #3–#8 closed/resolved). Real deliveries: 18 processed, 4 ignored (`opened` ×2, `labeled` ×2), 0 failed. No GitHub data deleted. |

Not exercised live: forged/wrong-repository deliveries (by design only locally), concurrent confirmation, ambiguous-create reconciliation against real GitHub, and rate limiting.

## Security and privacy findings

- **Release blocker for any further public exposure:** while `/login` was reachable through the public tunnel, `.env` used the `.env.example` `BETTER_AUTH_SECRET` and the owner password hard-coded in committed E2E specs. SECURITY.md already requires unique values before tunnelling. Rotate both (then `pnpm db:seed` or re-bootstrap the owner) and invalidate existing sessions before exposing the dashboard again.
- The privacy gate (D1, D2) is now stricter but still regex- and phrase-based; operator preview remains required.
- Forged, modified, wrong-secret, missing-delivery, malformed, and cross-repository/installation deliveries are rejected or ignored through the real route without state change.
- The mock tracker cannot be selected in production, and missing App credentials fail closed.
- No contact data appeared in any published issue, ticket event, or classifier input checked.

## Idempotency and concurrency

- Submission: same key and content → same ticket (DB, E2E, live HTTP); changed content → `SubmissionConflictError`/409 (DB and existing unit); concurrent identical → one ticket (existing DB test).
- Creation: repeat → `already-linked` (DB, E2E, live); concurrent confirmations → one create (existing DB test); rate-limit → `retry_required` → reconcile-first retry creates once (DB); ambiguous → reconcile only, never create on a miss (unit and existing DB).
- Webhooks: same delivery ID → `duplicate` (DB, E2E, **live redelivery**); new delivery with the same state → `already_current`, no events (DB, E2E); a late replay of the close after reopen cannot regress (DB, E2E, live).
- Live observation: GitHub's issue listing lagged a just-created issue by a few seconds. Reconciliation uses the same listing, so an immediate reconciliation after an ambiguous create can miss. It then stays `needs_reconciliation` and never creates, which is the documented safe outcome; operators may need to retry the check.

## Full gate results

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 104 tests, 17 files (previously 80) |
| `pnpm test:db` | Passed: 17 |
| `pnpm test:ai` | Passed: 6 |
| `pnpm test:github` | Passed: 13, 2 files (previously 6) |
| `pnpm ai:evaluate` | Passed: 7/7 |
| `pnpm build` | Passed |
| `pnpm test:e2e` | Passed: 17 Chromium tests (previously 14) on 3100/3101 beside a running `pnpm dev`. The first run failed one new case because Playwright re-serialized a deliberately malformed string body, invalidating its signature; the helper now sends exact bytes. |
| `git diff --check` | Passed |
| `LIVE_GITHUB_TEST=1 pnpm github:live-journey …` | Fixture run: steps 5–14 pass, then runner bugs (fixed) with manual completion; Jev run: 19/19 pass |

## Remaining mock-only boundaries and known limitations

- Concurrent confirmation, ambiguous-create reconciliation, GitHub rate limits and outages, and repository-identity mismatch are validated against the mock or the DB only.
- Out-of-order distinct webhook deliveries can still regress state (Phase 8 known issue); not exercised live.
- The live runner creates a new ticket and issue per run; do not rerun blindly after a failure.
- E2E rewrites the tracked `next-env.d.ts` to `.next-e2e`; restore with `git checkout -- apps/*/next-env.d.ts` (pre-existing Next typegen churn).
- `pnpm dev:e2e` rebuilds the shared package `dist` output, which a concurrent `pnpm dev` watcher also writes; the outputs are identical, but watch for a stale demo bundle if one appears.

## Non-blocking follow-ups

- The label-omission notice reuses the `github_escalation_requested` event type, so live timelines show "requested" twice. Give it its own event type.
- The dashboard GitHub route constructs the tracker before previewing, so a preview returns 503 when App credentials are absent.
- Fixture classifications still satisfy numeric eligibility (Phase 8 review item 7); issue #1 was created from a fixture decision before the Jev re-triage.
- Octokit warns that the current REST API version for issue create/update is scheduled for removal on 2028-03-10; pin a newer `X-GitHub-Api-Version` before then.
- `webhook_events.project_id` stays null for linked deliveries (Phase 8 review item 13).

## Recommended manual validation

1. Rotate `BETTER_AUTH_SECRET` and the owner password before exposing a tunnel again.
2. After any App reconfiguration, confirm `events` includes `issues` and Recent Deliveries show `issues` 2xx, not only `ping`.
3. Visually review one preview and one published issue per content change to the draft template.
4. Keep using `andrewbaisden/ai-support-platform-live-test`; do not connect the portfolio repository until the blocker above is resolved and the owner approves.
