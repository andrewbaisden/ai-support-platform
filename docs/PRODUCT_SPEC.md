# Product specification

This document keeps the product definition and MVP boundaries that previously lived in the README. For implementation contracts and state transitions, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Purpose and audience

IssueRelay gives a website or application a reusable support entry point and gives its operator a controlled path from visitor report to engineering work. The first dashboard serves one owner. Workspaces and projects separate tickets and repository connections so more sites can be added without sharing data.

## MVP journey

1. A visitor opens the widget and chooses a question, bug report, or feature request. Name and email are optional.
2. The public API validates the submission and stores its conversation, first message, and ticket before external work begins. A retry with the same submission ID and content returns the same ticket reference.
3. A bounded classifier proposes type, severity, and confidence. Deterministic policy routes questions to support, feature requests to product, bugs to engineering, and spam to quarantine. Failed triage leaves the accepted ticket available for review or retry.
4. An operator inspects the classification and any sensitive content. Eligible engineering bugs show a deterministic GitHub issue preview. Issue creation requires explicit operator confirmation.
5. The GitHub App creates and links one issue. Signed issue webhooks update the linked issue state. Closing it can resolve the support ticket; reopening it can reopen a ticket whose latest resolution came from GitHub.

The end-to-end demo succeeds when a synthetic bug moves from the demo widget to a durable ticket, is classified and reviewed, becomes exactly one issue in a disposable repository, and reflects close/reopen events in the dashboard. Questions and feature requests must keep their intended routes without creating engineering issues.

## Included capabilities

- An internal React widget with bundled Shadow DOM styles, a demo consumer, and an HTTP submission client.
- A public ticket API with project identification, origin restrictions, request validation, per-project rate limiting, and idempotent persistence.
- PostgreSQL conversations, messages, tickets, append-only classifications, human overrides, events, GitHub integrations, issue links, and webhook delivery records.
- Fixture triage for offline work and an opt-in Jev adapter. Classification receives the message and category hint, never visitor contact details.
- An authenticated, workspace-scoped dashboard for ticket lists, detail, re-triage, status changes, and human review.
- A GitHub App integration with privacy screening, preview, explicit creation, reconciliation, and signed inbound issue-state synchronization.
- Offline unit, database, AI, GitHub, and browser tests. Live external-provider checks are opt-in.

## Product rules

- Accepting a support request does not depend on AI or GitHub availability.
- The visitor's category hint remains distinct from AI classification. Classifications and human decisions retain their history.
- AI recommends; application policy decides routes and eligibility. Confidence is a ranking signal, not a calibrated probability.
- Contact details, credentials, and unrelated private conversation content must not be published to GitHub. An operator reviews the final issue preview.
- A human decline remains in force until a newer explicit human recommendation changes it. External issue creation never happens automatically in the current MVP.
- A GitHub webhook can change only an issue linked to the matching repository and App installation. Manual ticket decisions take precedence according to the recorded status provenance.

## Deferred capabilities and non-goals

Automatic AI replies, visitor notifications, GitHub comment synchronization, knowledge-base ingestion, complex retrieval, autonomous agents, billing, public signup, advanced duplicate detection, analytics, and additional communication channels are outside the current MVP. External widget publication and portfolio installation are later work. See [the roadmap](ROADMAP.md) and the [Phase 8 handoff](handoffs/phase-08.md) for the sequence and known limitations.
