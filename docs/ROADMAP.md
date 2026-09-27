# Roadmap

The implementation history is preserved in [phase handoffs](handoffs/). This is a planning summary, not a promise of release dates. The current repository has completed Phase 8 and its [follow-up review](reviews/phase-08-grok-review.md). A live GitHub validation and a production-readiness pass remain before public use.

| Phase | Outcome | State |
| --- | --- | --- |
| 0 | Product definition, architecture, decisions, security and test plans | Complete |
| 1–2 | Monorepo foundation, domain model, PostgreSQL schema and seed | Complete |
| 3–4 | Internal widget, demo consumer and public ticket ingestion | Complete |
| 5–6 | AI triage and owner dashboard | Complete |
| 7–8 | Operator-confirmed GitHub escalation and signed webhook synchronization | Complete locally; live GitHub validation pending |
| 9 | Complete and validate the controlled demo journey in a disposable repository | Planned, requires owner approval |
| 10–12 | Production hardening, external widget package validation and npm publication | Later |
| 13–15 | Portfolio installation, dogfooding and technical article | Later |

## Next validation

Use a disposable repository and synthetic ticket. Verify the App's repository and author identity, create exactly one issue, close and reopen it in GitHub, and inspect both webhook deliveries and dashboard state. A public HTTPS endpoint is needed for the webhook. Replace example owner credentials and Better Auth secret before exposing a local instance through a tunnel. The [Phase 8 handoff](handoffs/phase-08.md) has the test path and [review](reviews/phase-08-grok-review.md) lists deferred production findings.

## Release status

There is no GitHub release, npm publication, or external widget installation guide yet. Package API validation, a license decision, and production hardening come before publication. Generative support replies, comment synchronization, notifications, and automatic GitHub escalation are not part of the current release path.
