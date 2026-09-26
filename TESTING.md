# Testing strategy

Phase 1 provides the test runners and app shells. Future phase gates must run the relevant checks, update this file with new real commands, and record results in that phase's handoff. Do not claim an unrun check passed.

## Commands available now

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
git diff --check
```

`pnpm test` runs Vitest with React Testing Library in jsdom. `pnpm test:e2e` starts both apps and runs the Playwright Chromium smoke test; install Chromium first with `pnpm exec playwright install chromium` if needed. `pnpm typecheck` checks root tooling configuration and both app projects after `next typegen`. CI runs the first five pnpm checks; browser tests are a separate local gate until product flows justify adding them to CI.

## Layers

| Layer | Required coverage | External dependencies in CI |
| --- | --- | --- |
| Unit (Vitest) | Zod boundaries, classification normalization, deterministic routing, confidence gates, issue mapping/redaction, ticket transitions, idempotency decisions | None; fake clock and adapters |
| Component (React Testing Library) | Widget keyboard flow, validation/errors, confirmation, focus management, accessible names and status announcements | None; mock public API |
| Integration (Vitest + test PostgreSQL) | Transactional ticket creation, duplicate submissions, tenant scoping, classification persistence, work claims, one-issue link, webhook deduplication and state changes | Local test database; mock Jev/GitHub |
| End-to-end (Playwright) | Demo website opens widget, submits bug, sees confirmation; owner sees classification and escalation; simulated GitHub close/reopen updates ticket | Local apps/database; fixture adapters |
| Optional live smoke | Official Jev request and disposable GitHub App/repository integration | Explicit keys and test repo; excluded from ordinary CI |

Use realistic fixtures and assert outcomes, not merely that mocks were called. CI must remain useful without paid provider access. An optional live test may validate credentials and provider shape but must never use the production portfolio repository. Review accessibility with automated checks and manual keyboard/screen-reader inspection before widget publication.

## Core fixtures

| Input | Expected type and route | GitHub candidate |
| --- | --- | --- |
| “The projects section becomes blank in Safari after switching to dark mode.” | `bug`, engineering | Yes if confidence, connection, and privacy checks pass |
| “It would be great if the portfolio had a search bar.” | `feature_request`, product | No |
| “What technologies did you use to build this website?” | `question`, support | No |
| “Buy cheap cryptocurrency now...” | `spam`, quarantine | No |

Add fixtures for category-hint disagreement, ambiguous bug reports, private tokens/contact details, prompt injection, repeated submission keys, provider timeout, malformed provider output, GitHub timeout after send, duplicate webhook delivery, wrong repository/installation, issue edit, close, and reopen. Use two workspace/project fixtures to test isolation.

## Acceptance and phase gates

- **Phase 0:** All requested documents exist, agree on MVP scope and state flow, cite current Jev/GitHub integration sources, and name unresolved operational inputs. No application scaffold or dependencies are added.
- **Phase 1:** `pnpm install`, `pnpm dev`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` work as documented. CI runs build, typecheck, lint, and tests; Playwright verifies both shells locally.
- **Phase 2:** Fresh database migrates and seeds; constraints and cross-tenant repository tests pass.
- **Phases 3–4:** Demo widget submits to API and receives the same ticket on idempotent retry; accessibility and API error paths pass.
- **Phases 5–6:** Validated classification persists, deterministic routes are correct, AI failures leave an actionable ticket, and owner dashboard shows history.
- **Phases 7–9:** Exactly one linked issue is created for an eligible demo bug; uncertain creates require reconciliation; signed, duplicate, wrong-repository, closed, and reopened webhooks behave correctly. Questions, features, and spam create no engineering issue.
- **Phase 10 onward:** Review security, failure recovery, privacy, accessibility, external package installation, and production behavior before publication or portfolio use.

At every implementation phase: update affected docs and ADRs, run relevant tests/typecheck/lint, summarize technical debt and unresolved decisions, and write `docs/handoffs/phase-XX.md` with exact commands and results. Do not add trivial tests that only repeat implementation details; prioritize boundary and failure behavior.
