# Roadmap

The implementation history is preserved in [phase handoffs](handoffs/). This is a planning summary, not a promise of release dates. The current repository has completed Phase 9: the [live journey validation](reviews/phase-09-live-journey-test-review.md) against a disposable repository and the [operational follow-up](handoffs/phase-09.md). A production-readiness pass (Phase 10) remains before public use.

| Phase | Outcome | State |
| --- | --- | --- |
| 0 | Product definition, architecture, decisions, security and test plans | Complete |
| 1–2 | Monorepo foundation, domain model, PostgreSQL schema and seed | Complete |
| 3–4 | Internal widget, demo consumer and public ticket ingestion | Complete |
| 5–6 | AI triage and owner dashboard | Complete |
| 7–8 | Operator-confirmed GitHub escalation and signed webhook synchronization | Complete; live-validated in a disposable repository |
| 9 | Complete and validate the controlled demo journey in a disposable repository | Complete ([handoff](handoffs/phase-09.md)) |
| 10–12 | Production hardening, external widget package validation and npm publication | Later |
| 13–15 | Portfolio installation, dogfooding and technical article | Later |

## Next validation

The live journey passed against `ai-support-platform-live-test` (see the [review](reviews/phase-09-live-journey-test-review.md)); repeat it with `LIVE_GITHUB_TEST=1 pnpm github:live-journey`. Before exposing a local instance through a tunnel again, replace the example owner password and Better Auth secret. The [Phase 8 review](reviews/phase-08-grok-review.md) and the live journey review list the deferred production findings.

## Release status

There is no GitHub release, npm publication, or external widget installation guide yet. Package API validation, a license decision, and production hardening come before publication. Generative support replies, comment synchronization, notifications, and automatic GitHub escalation are not part of the current release path.
