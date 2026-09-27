# Phase 8 handoff — signed GitHub issue state synchronization

## Delivered

- `POST /api/webhooks/github` is a Node.js route with no Better Auth session requirement. `GITHUB_WEBHOOK_SECRET` is server-only and required only when this route runs. The endpoint reads at most 1 MiB from the request stream, verifies the exact raw bytes against `X-Hub-Signature-256` with HMAC-SHA256 and `timingSafeEqual`, then decodes JSON. Missing, malformed, and incorrect signatures receive the same public error.
- Requires a UUID `X-GitHub-Delivery` and bounded `X-GitHub-Event`. A minimal Zod subset of `issues` accepts action, issue ID/number/state, repository ID/name/owner, and optional installation ID. Only `closed`/`reopened` mutate state. `edited` and other issue actions are acknowledged as ignored; `ping` is acknowledged. No title, body, comment, or customer data sync.
- The application service in `packages/github` matches repository ID + remote issue ID and checks issue number, installation ID, and active integration. A marker in issue text grants no authority. The DB join follows project-matching links, so a repository or installation mismatch cannot mutate another project's ticket.
- The existing `webhook_events` table records safe delivery metadata, processing outcome, and timestamps. The unique provider/delivery constraint serializes concurrent copies. Delivery insertion, locked issue/ticket lookup, remote state, ticket transition, and audit events commit in one transaction. An exception rolls all of them back; the same delivery can be manually redelivered. Semantic repeats with new delivery IDs are no-ops when the issue state is already current.
- `issues.closed` changes the linked issue to `closed`; a queued engineering ticket becomes `resolved`, with `github_issue_closed` and `ticket_resolved_from_github` timeline events. `issues.reopened` changes the link to `open`; a resolved ticket reopens to `queued` only if its latest status-changing event is `ticket_resolved_from_github`. Human resolution or subsequent human reopen takes precedence. The existing shared `canTransition` guard protects the webhook status write. The dashboard shows issue number, Open/Closed, repository, external link, and provenance events.

## Official GitHub documentation checked

- [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries): GitHub sends `X-Hub-Signature-256`, calculated with the configured secret over the original payload; timing-safe comparison is recommended.
- [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads): `X-GitHub-Event` identifies the event; `issues` contains issue and repository data, and GitHub App deliveries include installation context; `ping` confirms setup.
- [Best practices for using webhooks](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks): subscribe only to needed events, use `X-GitHub-Delivery` against replay, check action, and respond within 10 seconds. Requested redelivery retains the same delivery ID.
- [Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries) and [redelivery](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks): GitHub does **not** automatically retry failures; App operators can redeliver recent failed deliveries through GitHub or build a separate recovery job. The route returns 503 on a transient DB failure but operational redelivery remains necessary.

## Configuration and live validation

In the GitHub App settings, configure `https://<platform-host>/api/webhooks/github` as the webhook URL, select JSON, set the same high-entropy secret as server `GITHUB_WEBHOOK_SECRET`, and subscribe to repository **Issues** only. HTTPS with SSL verification is required for live use. No tunnel dependency is installed; a temporary public HTTPS tunnel can expose local development for an opt-in test. Create/link one issue through Phase 7 in a disposable repository, close it in GitHub, confirm the delivery is successful and the dashboard shows Closed/Resolved, reopen it, and confirm Open/Queued. Inspect GitHub Recent Deliveries and manually redeliver any failed delivery.

**Live status:** Not run. No GitHub App credentials, disposable repository, or public webhook endpoint were available in this environment. Offline signed E2E used the real HTTP endpoint and mock issue linkage.

## Verification

| Command | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; lockfile unchanged |
| `pnpm lint` | Passed after formatting |
| `pnpm typecheck` | Passed; all apps/packages |
| `pnpm test` | Passed; 76 tests, 15 files |
| `pnpm test:db` | Passed; 16 tests, 3 files, including concurrent duplicate and rollback/retry |
| `pnpm test:ai` | Passed; 6 tests |
| `pnpm test:github` | Passed; 5 tests |
| `pnpm build` | Passed; route emitted as dynamic |
| `pnpm test:e2e` | Passed; 14 Chromium tests after serializing shared local dev-server workers, including signed close/reopen |
| `git diff --check` | Passed |

Database suites initially failed under the filesystem sandbox with `connect EPERM 127.0.0.1:54339`; they passed after approved execution outside the sandbox. The first browser pass exposed parallel local Better Auth sign-in flakiness and overly broad new text selectors. The final serial browser run passed all cases.

## Security and recovery review

The secret and raw payload are never logged or stored; safe logs contain delivery ID, event/action, repository ID, issue number, and outcome. The signature is verified before untrusted JSON parsing. The actual streamed-body cap limits memory even when `Content-Length` is absent or false. Database uniqueness prevents same-ID replay across instances. Repository ID, issue ID/number, installation ID, active integration, and composite project links protect isolation. Unknown issues receive generic acknowledgement. A compromised secret could forge new signed deliveries; rotate both App/server values if suspected. Synchronous processing and the 1 MiB cap should be monitored against GitHub's 10-second response window.

## Deviations and known issues

- `issues.edited` is acknowledged without metadata persistence. No remote metadata beyond state is needed for Phase 8, and local support content is never overwritten.
- No schema migration was needed; `webhook_events` and append-only ticket events provide deduplication and resolution provenance.
- Distinct, delayed close/reopen events can still regress state because the service does not fetch the current GitHub issue or persist a provider ordering token. Reconcile manually if observed; a later measured need may justify fresh remote-state reads or an ordering field.
- A failure returns 503 and rolls back, but GitHub does not automatically retry. Operators must inspect and redeliver failed deliveries; automated redelivery is deferred.
- Marker-only recovery of a Phase 7 `needs_reconciliation` issue remains deferred. Inbound events require an established remote link.

## Exact recommended Phase 9 starting point

After owner approval and a disposable-repository live close/reopen validation, complete the controlled demo journey end to end and address observed operational gaps. Begin by checking delivery latency, GitHub Recent Deliveries, out-of-order event exposure, and unresolved Phase 7 reconciliation. Keep generative replies, comment synchronization, notifications, automatic escalation, npm publication, and portfolio installation outside Phase 9 unless separately approved by the owner.
