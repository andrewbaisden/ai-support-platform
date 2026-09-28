# Phase 9 handoff — complete and validate the demo journey

Owner-approved on 2026-09-28. Phase 9 has two parts:

- the [live journey review](../reviews/phase-09-live-journey-test-review.md), which validated steps 5–15 against a real GitHub App and a disposable repository and fixed the privacy gate and E2E isolation;
- the operational follow-up recorded here.

No generative AI, notifications, comment sync, automatic escalation, npm publication, or portfolio work was added.

## Delivered

| Change | Defect or gap | Regression test (written first, seen failing) |
| --- | --- | --- |
| **Provenance gate** (`packages/github/src/provenance.ts`, ADR-022) | The live issue #1 was published from a fixture classification; the numeric threshold cannot tell fixture from model confidence (Phase 8 review item 7). | `preview.test.ts` and `escalation-service.test.ts` (fixture blocked, owner recommendation or mock policy allowed); `journey.integration-test.ts` (real owner override in PostgreSQL unblocks; AI history unchanged) |
| **Reconcile check reaches the service** (dashboard GitHub route) | "Check for existing issue" on a `needs_reconciliation` link returned the preview and never ran reconciliation. | `route.test.ts` (unknown outcome claims, reconciles only, stays `needs_reconciliation`, returns `GITHUB_CREATION_UNKNOWN`) |
| **Preview without App credentials** | The route built the GitHub App client before previewing, so previews returned 503 when credentials were absent. | `route.test.ts` (preview 200; create fails closed with `GITHUB_MISCONFIGURED`) |
| **`github_labels_omitted` event** | The label notice reused `github_escalation_requested`, so live timelines showed "requested" twice. | `escalation-service.test.ts` (requested → labels omitted → created) |
| **Webhook project attribution** | `webhook_events.project_id` was always null (Phase 8 review item 13). | `webhook.test.ts` (processed → project; ignored with a found link → null); journey delivery assertion |
| **Recovery runbook** | No operator guidance for unknown outcomes, stuck claims, list lag, or missed deliveries. | Docs: [docs/GITHUB_RECOVERY.md](../GITHUB_RECOVERY.md); dashboard copy now points to it |
| **Live runner** | Fixture triage now needs an owner recommendation; unreachable platform threw an uncaught error. | The runner records the recommendation as `--operator-email`/`SEED_OWNER_EMAIL`, and aborts cleanly when the platform is down (verified: no ticket created) |

`allowFixtureClassifications` is true only for fully synthetic paths: the non-production `GITHUB_ESCALATION_MOCK=1` dashboard, the mock `github:escalate` CLI, and tests. The real App dashboard, `github:escalate --live`, and the live runner never set it.

## Verification

| Command | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | Passed: 110 tests, 18 files |
| `pnpm test:db` | Passed: 18 |
| `pnpm test:ai` | Passed: 6 |
| `pnpm test:github` | Passed: 14, 2 files |
| `pnpm ai:evaluate` | Passed: 7/7 |
| `pnpm build` | Passed |
| `pnpm test:e2e` | Passed: 17 on 3100/3101 with the isolated E2E database |
| `git diff --check` | Passed |
| `LIVE_GITHUB_TEST=1 pnpm github:live-journey --repository andrewbaisden/ai-support-platform-live-test` | **20/20 passed** (SUP-335 → issue #9, fixture triage). Owner recommendation recorded (`rerouted`); `github_labels_omitted` recorded once; close/reopen webhooks synced; redelivery a no-op (events 10→10); finished closed. |
| `… --classifier jev` | **19/19 passed** (SUP-336 → issue #10). Jev: bug/engineering, confidence 1.00, `model` provenance, so no recommendation was needed; finished closed. |

The first attempt after these changes aborted cleanly while the platform was down: no ticket was created, and the only GitHub calls were read-only. After the owner rotated `BETTER_AUTH_SECRET` and the owner password and restarted the platform and tunnel, both live runs passed. Real deliveries for issue #9 show processed `closed`/`reopened` rows attributed to the project, and ignored `opened`/`labeled` rows unattributed. Earlier journey evidence (issues #1–#8) is in the live journey review.

## Known issues

- The owner rotated the local `BETTER_AUTH_SECRET` and owner password before the final live runs. Keep unique values whenever a tunnel is exposed.
- Seeded and earlier fixture-triaged tickets now show `classification source fixture needs …` on a real App configuration. Re-triage with Jev or record an owner recommendation.
- Recovering an interrupted `creating` claim still needs a guarded SQL update (runbook); there is no dashboard tool.
- Out-of-order distinct webhook deliveries can still regress state (Phase 8 known issue).
- GitHub's issue list can lag a new issue; reconciliation fails safe but may need a second check.
- The Octokit REST API version used for issue create/update is scheduled for removal on 2028-03-10.

## Deferred to Phase 10 (production hardening)

These need owner approval:

- email verification and sign-up policy;
- require `Origin` on dashboard mutations;
- harden the callback-URL helpers;
- owner/member role gates;
- database pooling and request budgets;
- remote-state-aware webhook ordering and recovery of deliveries that arrive before the link exists (Phase 8 review items 5, 10–12, 14);
- a strict-CSP widget test;
- a license decision;
- the retention policy.

## Exact Phase 10 starting point

After owner approval, start production hardening with the Phase 8 review's deferred security items (Origin requirement, callback helpers, role gates, email verification) before choosing hosting. Keep npm publication and portfolio installation for their later phases.
