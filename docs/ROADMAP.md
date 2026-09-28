# Roadmap

The implementation history is preserved in [phase handoffs](handoffs/). This is a planning summary, not a promise of release dates. The project is now branded IssueRelay. The current repository has completed Phases 11–13 and deployment: the widget runs on the owner's portfolio site, `@issuerelay/widget@0.1.0` is on npm and the platform runs on Vercel with Neon and Resend. Phase 16 makes the platform self-hostable, so anyone can deploy their own IssueRelay and install the widget against it. Phase 9 [validated the journey live](reviews/phase-09-live-journey-test-review.md) and [closed its operational gaps](handoffs/phase-09.md); Phase 10 [hardened production behavior](handoffs/phase-10.md); hosting, email verification, and scheduled retention are chosen at deployment.

| Phase | Outcome | State |
| --- | --- | --- |
| 0 | Product definition, architecture, decisions, security and test plans | Complete |
| 1–2 | Monorepo foundation, domain model, PostgreSQL schema and seed | Complete |
| 3–4 | Internal widget, demo consumer and public ticket ingestion | Complete |
| 5–6 | AI triage and owner dashboard | Complete |
| 7–8 | Operator-confirmed GitHub escalation and signed webhook synchronization | Complete; live-validated in a disposable repository |
| 9 | Complete and validate the controlled demo journey in a disposable repository | Complete ([handoff](handoffs/phase-09.md)) |
| 10 | Production hardening | Complete ([handoff](handoffs/phase-10.md)) |
| 11 | External widget package validation | Complete ([handoff](handoffs/phase-11.md)) |
| 12 | npm publication of `@issuerelay/widget` | Complete: 0.1.0 published and verified ([handoff](handoffs/phase-12.md)) |
| Deploy | Vercel + Neon hosting, Resend email verification, scheduled retention | Complete ([handoff](handoffs/deployment.md), [runbook](DEPLOYMENT.md)) |
| 13 | Portfolio installation | Complete ([handoff](handoffs/phase-13.md)) |
| 14–15 | Dogfooding | Ongoing |
| 16 | Self-hosted IssueRelay: Deploy to Vercel button, first-run `/setup`, project settings (key, origins, connect repository), GitHub App from a manifest, [self-hosting guide](SELF_HOSTING.md) | Implemented and tested locally; fresh-deploy proof pending ([handoff](handoffs/phase-16.md)) |
| Future | Hosted multi-tenant IssueRelay (public sign-up, invitations, billing) | Not planned yet |

## Next validation

The live journey passed against `ai-support-platform-live-test` (see the [review](reviews/phase-09-live-journey-test-review.md)); repeat it with `LIVE_GITHUB_TEST=1 pnpm github:live-journey`. Before exposing a local instance through a tunnel again, replace the example owner password and Better Auth secret. The [Phase 8 review](reviews/phase-08-grok-review.md) and the live journey review list the deferred production findings.

## Release status

The widget is MIT-licensed and validated as an external package; `@issuerelay/widget@0.1.0` is published on npm; later releases follow [docs/RELEASING.md](RELEASING.md). Generative support replies, comment synchronization, notifications, and automatic GitHub escalation are not part of the current release path.
