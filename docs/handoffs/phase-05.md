# Phase 5 handoff — Jev AI triage

## Completed

- Created `packages/ai` (`@ai-support-platform/ai`, source-exported like `packages/db`): provider-neutral `TicketClassifier` interface with Zod input/result schemas, `JevTicketClassifier` adapter over one official `systemOne` call, deterministic `FixtureTicketClassifier`, routing/escalation policy, `triageTicket` application service, versioned fixture dataset, evaluation runner, and `ai:triage` / `ai:evaluate` CLIs.
- Added repository reads `listTicketsNeedingTriage`, `findTicketContext`, `getTicketSubmissionText`, `recordTicketEvent`, and `listTicketEvents`; exported `requireSafeTestDatabaseUrl` on the db boundary. No schema migration was needed: `ticket_classifications` already stores type/severity/route/recommendation/confidence/source/provider/model/reason.
- Verified the official integration first: `@typesafe-ai/sdk` pinned at `0.6.0`, `TypeSafeClient.systemOne({state, questions})` with `choice` helpers, `TYPESAFE_API_KEY` auth, `jev-latest` default model, per-label `probabilities` plus derived `confidence`, 10 s default attempt timeout with bounded internal retries, `warn`-level logging (bodies only at `debug`, never enabled), and a browser-runtime refusal that doubles as a server-only enforcement.
- Normalized confidence strictly as the selected type label's probability; out-of-set labels or missing probabilities fail closed to `AI_SCHEMA_VALIDATION_FAILED`.
- Policy owns route (`bug`→engineering, `feature_request`→product, `spam`→ignore, rest→support) and escalation eligibility (bug + engineering + confidence ≥ 0.90 hypothesis in `config.ts`); stored as `githubIssueRecommended` with no GitHub call.
- Triage runs explicitly (`pnpm ai:triage --pending [--limit N]`, `--ticket <uuid>`, `--classifier mock|jev`); ingestion is untouched and tickets survive provider failure in `needs_triage` with a `triage_failed` event. Already-triaged tickets are skipped; concurrent runs converge on coherent state.
- Updated README, ARCHITECTURE, DECISIONS (ADR-017), AI_ENGINEERING (verified SDK findings), AGENTS, SECURITY, TESTING, `.env.example` (commented `TYPESAFE_API_KEY`), CI (`test:ai`, `ai:evaluate`), and root scripts.

## Jev SDK/API used

`@typesafe-ai/sdk@0.6.0`, `POST {baseURL}/v1/systemone` via `TypeSafeClient`. State `{message, category_hint}`, questions `ticket_type` (8-label choice) and `severity` (4-label choice), wording version `triage-v1`. Errors mapped: timeout→`AI_TIMEOUT`, connection→`AI_PROVIDER_UNAVAILABLE`, 401/403→`AI_MISCONFIGURED`, 429/5xx→`AI_PROVIDER_UNAVAILABLE`, other→`AI_INVALID_RESPONSE`; missing key→`AI_MISCONFIGURED` without network.

## Classifier interface

`classify({message, categoryHint?}) → {type, severity, confidence, reason?, provider, model}` (Zod-validated). Application code never sees SDK shapes; a future provider swaps behind the interface.

## Fields sent to Jev

Message and category hint only. No name, email, IDs, secrets, or credentials. Input schema strips anything else.

## Classification schema

8 types × 4 severities (db value sets), confidence 0–1, deterministic audit reason (adapters never generate prose), provider/model provenance, source `model` (Jev) or `fixture` (mock).

## Ticket routing behavior

Success appends history and moves `needs_triage`→`queued` (route per policy) or →`quarantined` (spam/`ignore`); `categoryHint` is preserved alongside disagreeing AI types. Success reuses the existing `classified` event; failures record `triage_failed`.

## Escalation policy and threshold

`evaluateGitHubEscalation`: eligible iff type bug + route engineering + confidence ≥ 0.90 (uncalibrated hypothesis) + above 0.50 review floor, with reasons recorded. Stored recommendation only; Phase 7 adds connection and publication-safety gates.

## Retry/failure model

SDK bounded retries, then manual re-triage; no queue infrastructure, no infinite loops. `AI_*` codes stay internal and never reach the widget.

## Evaluation/test results

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed; 82 files |
| `pnpm typecheck` | Passed (tooling, contracts, widget, apps, db, ai) |
| `pnpm test` | Passed: 45 tests / 8 files (incl. 20 new AI unit: policy, fixture, evaluation, service, Jev normalization/error mapping with stub transport) |
| `pnpm test:db` | Passed: 7 existing cases, no regression |
| `pnpm test:ai` | Passed: 6 triage integration cases (end-to-end, disagreement, spam, failure, isolation+concurrency, listing helpers) |
| `pnpm ai:evaluate` | Passed: mock 7/7 fixtures |
| `pnpm ai:triage --pending` | Verified live against dev DB (5 tickets classified with routes/eligibility) |
| `pnpm build` | Passed |
| `pnpm test:e2e` | Passed: 6 Chromium cases, no regression |
| `git diff --check` | Passed |

Live Jev validation: no account key exists in this environment, so no valid-key classification was performed. A dummy-key live round-trip confirmed transport, auth handling, and the 401→`AI_MISCONFIGURED` mapping against the real API with zero visitor data transmitted; the evaluate CLI reports per-case provider errors cleanly instead of crashing.

## Deviations

- ADR-017 covers the ai boundary, policy-owned routing, explicit execution, and failure model.
- Added a third test runner (`test:ai`, node env) instead of forcing DB-backed triage tests into the db package, which would have created a db→ai dependency cycle; ai core stays db-free.
- `evaluate` records per-case classifier errors rather than throwing, so live runs report observations.
- No honeypot/timing additions; out of scope for triage.

## Known issues

- 0.90 threshold and mock confidences are uncalibrated; formal calibration needs a collected dataset and a valid-key Jev run.
- TypeSafe data-retention terms for submitted text unverified; review before production use.
- Low-confidence tickets route normally with an audit trail; the owner review surface arrives with the Phase 6 dashboard.
- Dev-DB tickets triaged during verification now carry fixture classifications (local-only, no production impact).

## Exact Phase 6 starting point

After owner approval, build the owner dashboard over classified tickets using `listTicketsForProject`, `getCurrentClassificationForProject`, and the new `listTicketEvents`; add manual re-triage/reclassification flows that append history through `appendClassification`. Do not start GitHub issue creation or generative AI.
