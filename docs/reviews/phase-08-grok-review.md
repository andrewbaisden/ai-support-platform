# Phase 8 follow-up review of Grok findings

Reviewed against the implementation after commit `1fe3db9`. This is a focused correction to Phases 7–8, not the start of Phase 9.

| # | Classification | Decision and evidence |
| --- | --- | --- |
| 1 | Valid | Fixed. An atomic `pending`/`retry_required`/`needs_reconciliation` → `creating` claim now precedes all GitHub calls. A concurrent loser cannot call create. Confirmation updates only while the remote ID is null. A simultaneous integration test asserts one remote create and refusal to replace a confirmed ID. |
| 2 | Valid | Fixed. Effective override fields are the latest non-null values ordered by monotonic `decision_number`; escalation and preview use the materialized ticket route. A decline persists through a later route-only decision. |
| 3 | Valid | Fixed. New markers include a digest of the private random ticket UUID. Reconciliation accepts only a standalone exact marker on a non-PR issue by this App's bot, after checking the installation token can read the configured owner/name and that GitHub returns the stored repository ID. Confirmed remote IDs cannot be overwritten. A local identity test rejects planted and PR candidates. App bot identity must still be exercised in the first disposable-repository live test. |
| 4 | Valid | Fixed. `rerouted` is not a status-provenance event; a review that changes status to queued records `reopened` or `released_from_quarantine`. `ticket_events.event_number` gives monotonic event order. A DB test proves review-only activity does not suppress GitHub reopening. |
| 5 | Deferred | The early-close race is real. Unknown issue deliveries currently become terminal `ignored`, and outbound confirmation still starts `open`. It does not affect the intended live sequence, where the issue is linked before close. Address before production with remote-state-aware confirmation and a recovery path for pre-link deliveries. |
| 6 | Valid | Fixed for a public demo. Visitor reports render inside an adaptive Markdown code fence, neutralizing mentions and image syntax. The privacy screen now blocks private/credential URLs, phone-shaped numbers, and JWT-shaped strings. The gate remains a conservative heuristic; operator inspection is still required. |
| 7 | Deferred | Fixture classifications can pass the numeric eligibility policy, but the dashboard labels the provider and requires operator confirmation. Acceptable only for synthetic local/demo reports; require model provenance or explicit human recommendation before production automation. |
| 8 | Deferred | `triageTicket` collapses all classification-write errors into `already-triaged`. This is a real error-reporting issue, but unrelated to the scoped GitHub live validation. Distinguish compare-and-swap loss from persistence failure before production. |
| 9 | Valid | Fixed at the side-effect boundary. `github:connect` still records operator-supplied IDs, but live escalation now uses the installation token to fetch owner/name and refuses creation unless the returned repository ID equals the stored ID. A misconfigured link therefore cannot publish into the wrong repository. |
| 10 | Partially valid | Three process-local pools and sequential network calls are real; the serverless deployment premise is not yet selected. Deferred: set connection limits/pooling and a request budget before hosted production. No effect on the single-process disposable-repo check. |
| 11 | Partially valid | Missing `Origin` is accepted on dashboard POSTs, but current `SameSite=Lax` session cookies block a cross-site form from carrying the session. Deferred: require Origin before changing cookie policy or hosting broadly. |
| 12 | Partially valid | The callback helper accepts backslash and encoded-slash path variants; an actual cross-origin redirect through the current Next.js routing has not been demonstrated. Deferred: harden both client and server helpers before hosted production. |
| 13 | Deferred | Webhook rows have null `project_id` even after a link is found. The authenticated link lookup and transaction preserve isolation; filling the metadata column would improve diagnostics. |
| 14 | Deferred | Members and owners share dashboard powers. The seeded MVP has one owner and no member invitation flow. Add role gates before a second member exists. |
| 15 | Valid | Fixed. `GITHUB_ESCALATION_MOCK=1` is ignored when `NODE_ENV=production`, so a deployed process cannot silently create mock links. |

## Additional live-run conditions

Use a disposable repository and verify the App bot's actual issue author in GitHub's response. The live App's bot identity check fails closed if GitHub uses an unexpected actor format. Use a unique owner password and `BETTER_AUTH_SECRET` before exposing a local instance through a public HTTPS tunnel; the example seed credentials must never be used on a public host. The first live test must still create, close, and reopen one linked synthetic issue and inspect webhook delivery results. No live GitHub call was available in this review.

## Transaction and recovery limits

A crash after the `creating` claim leaves the intent in `creating`; it cannot be safely reclaimed automatically because the remote create may have succeeded. That state blocks another create and needs operator reconciliation. A timeout or other ambiguous create result moves to `needs_reconciliation`; subsequent attempts search for a trusted App-authored issue but never create another when the search misses. Clear GitHub rejections move to `retry_required` and can be retried after the problem is corrected.

## Verification

`pnpm db:generate` produced reviewed migrations `0004` (creating state) and `0005` (monotonic audit ordering). `pnpm install --frozen-lockfile`, `pnpm db:check`, `pnpm db:migrate`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (80), `pnpm test:db` (17), `pnpm test:ai` (6), `pnpm test:github` (6), `pnpm build`, `pnpm test:e2e` (14), and `git diff --check` passed. The first full E2E run caught a false phone-number match inside a random UUID; the regex and regression test were corrected, then the targeted and full E2E suites passed. No live GitHub webhook test was run.
