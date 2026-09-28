# GitHub escalation and webhook recovery

This is the operator runbook for GitHub states that need a human. The rule throughout: **never create a second issue while the first one might exist.** The code already refuses to; these steps only help you finish what it left for review.

Every escalated issue body carries one opaque marker line, `<!-- ai-support-ticket:SUP-<n>:<32 hex> -->`. The marker is hidden in the rendered issue. To find it, search the repository's issues for `ai-support-ticket:SUP-<n>` or open the issue's Markdown source.

## Issue link states

| Dashboard shows | Stored state | Meaning | What to do |
| --- | --- | --- | --- |
| Create GitHub issue (after an error) | `retry_required` | GitHub clearly rejected the request (auth, permission, missing repository, rate limit); no issue can exist | Fix the cause (App installation, permissions, wait out the rate limit), then create again. The retry searches by marker before creating. |
| Check for existing issue | `needs_reconciliation` | A timeout or connection loss after sending; the issue may or may not exist | See [Unknown outcome](#unknown-outcome). |
| Creation in progress | `creating` | A request holds the exclusive claim | Refresh. If it stays for more than a few minutes, see [Interrupted creation](#interrupted-creation). |
| GitHub Issue #n · Open/Closed | `open` / `closed` | Confirmed link | Nothing; close/reopen sync arrives by webhook. |

### Unknown outcome

1. Click **Check for existing issue**. It looks for an issue created by this App's bot that contains the exact marker in the connected repository, and links it if found. It never creates an issue.
2. GitHub's issue list can lag a just-created issue by several seconds (observed during the live journey). If the check finds nothing right after the failure, wait a minute and check again.
3. If it still finds nothing, search GitHub yourself for `ai-support-ticket:SUP-<n>`:
   - **Found, by the App bot:** the automated check should have linked it; confirm the connected repository in the dashboard matches, then check again.
   - **Found, by anyone else, or on a pull request:** do not link it. It is not trusted (the marker alone never authorizes a link). Close it if it is a stray copy.
   - **Not found after several minutes:** GitHub most likely did not create it. Automatic creation stays blocked on purpose; a developer can move the row back to `retry_required` (below) so the next create reconciles first and then creates once.

### Interrupted creation

A process crash after claiming `creating` leaves the claim in place, and nothing can safely release it automatically. After confirming no request is still running (a few minutes have passed):

```sql
-- Development/owner database access only. Moves the claim to review;
-- the next dashboard action reconciles and never blindly creates.
UPDATE github_issues
SET status = 'needs_reconciliation', updated_at = now()
WHERE ticket_id = '<ticket uuid>' AND status = 'creating' AND github_issue_id IS NULL;
```

Then follow [Unknown outcome](#unknown-outcome). Only after confirming no issue exists should `needs_reconciliation` be moved to `retry_required` with the same kind of guarded update.

## Webhook delivery problems

- **Nothing arrives:** in the GitHub App settings, confirm the webhook is active, the URL ends in `/api/webhooks/github`, and **Subscribe to events → Issues** is ticked. An App with Issues permission but no Issues subscription receives only `ping`. The live journey hit exactly this.
- **Failed delivery (4xx/5xx):** fix the cause (secret mismatch → 401, database outage → 503), then use **Redeliver** under the App's Advanced → Recent Deliveries. GitHub does not retry failures automatically. Redelivery keeps the delivery ID, so a delivery that already succeeded is a safe no-op.
- **Changes GitHub never sent** (for example, closes made before the subscription existed): there is nothing to redeliver. Reopen and close the issue in GitHub again so fresh events are sent.
- **Out-of-order events:** a delivery older than the state already applied is ignored as `stale_event` (Phase 10), and a close that arrives before the link exists is picked up by the state read after linking. Two events in the same second cannot be ordered; if the dashboard and GitHub still differ, toggle the issue in GitHub to send the current state again.
- **Tunnels:** a quick-tunnel hostname can stop resolving while the process still runs. Start a new tunnel, update the App webhook URL, and redeliver anything that failed in between. Rotate the example owner password and `BETTER_AUTH_SECRET` before exposing the dashboard.

## Accidental publication

If private data reaches a GitHub issue despite the privacy gate: edit the issue to remove it, delete the edit history if needed (repository admin), rotate any exposed credential immediately, and record the incident. The gate is a heuristic, not proof of safety.
