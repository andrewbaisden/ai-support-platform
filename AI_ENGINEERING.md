# AI engineering

## Responsibility split

| Owner | Responsibility |
| --- | --- |
| Deterministic application code | Validate inputs and provider output; enforce project ownership, privacy, routing policy, confidence threshold, state transitions, retries, and GitHub side effects. |
| Jev | Make bounded judgments from the submitted message and category hint: ticket type, severity, and optional component/bug candidacy. It does not authorize an issue or choose a repository. |
| Generative provider | Optionally draft a concise issue title/body or, in a later phase, draft a support answer. Generation is never required to accept a ticket. |
| Human owner | Review uncertain or sensitive reports, correct classifications, approve or decline manual escalations, and resolve reconciliation cases. |

## Provider contracts

`TicketClassifier.classify(input): Promise<TicketClassification>` is an application interface. Input contains the visitor message, optional category hint, and project-approved context; it excludes email, name, secrets, and unrelated conversations. The normalized, Zod-validated result contains `type` (`question`, `bug`, `feature_request`, `account`, `billing`, `feedback`, `spam`, `other`), `severity` (`low`, `medium`, `high`, `critical`), a confidence number from 0 to 1, optional component from a project-controlled allowlist, and provenance (`provider`, model/version, time). Route and `createGitHubIssue` are **derived by application policy**, not blindly trusted fields from the model. Missing, malformed, or out-of-range provider values fail validation and leave the ticket for retry or review.

The `IssueDraftGenerator.generate(input): Promise<IssueDraft>` interface receives only redacted, publication-approved facts and returns a draft title and body. A deterministic issue template is the fallback. Generated text is validated for size and checked again for private data before publication. A future `SupportAnswerDrafter` remains separate and is not part of the first MVP.

## Jev integration decision

Use the official TypeSafe JavaScript SDK, `@typesafe-ai/sdk` pinned at `0.6.0`, server-side on Node.js. Its documented API creates `TypeSafeClient`, calls `systemOne({ state, questions })`, and defines bounded questions with helpers such as `choice`. Keep those calls entirely inside `JevTicketClassifier`; application services see only the normalized contract. Do not use an OpenAI-compatible chat route or assume Jev generates prose.

Verified against the published 0.6.0 package and docs on 2026-09-27:

- Authentication is a `Bearer TYPESAFE_API_KEY` header; the client also honors `TYPESAFE_BASE_URL` (default `https://api.typesafe.ai`) and `TYPESAFE_DEFAULT_MODEL` (default `jev-latest`). The constructor refuses browser runtimes unless explicitly overridden, which the platform never does.
- One `systemOne` call carries `{ message, category_hint }` state plus `ticket_type` (8-label choice) and `severity` (4-label choice) questions, returned in parallel with per-label `probabilities`, a reported `confidence`, the answering `model`, and token `usage`.
- `confidence` is derived from the probability spread, not a calibrated probability: concentrated mass reads high, flat distributions read low. The adapter therefore normalizes confidence as the probability of the *selected type label* and treats a missing or out-of-range value as invalid rather than inventing one. Policy thresholds (0.90 escalation, 0.50 review floor) follow the documented risk-scaling guidance and remain uncalibrated hypotheses.
- Per-attempt timeout defaults to 10 s; the SDK retries 408/429/5xx, connection errors, and timeouts internally with bounded backoff (default 2 retries). Mapped failures are `AI_TIMEOUT`, `AI_PROVIDER_UNAVAILABLE`, `AI_INVALID_RESPONSE`, `AI_SCHEMA_VALIDATION_FAILED`, and `AI_MISCONFIGURED` (missing key, 401/403). Tickets stay in `needs_triage` with a `triage_failed` event for manual retry.
- Logging defaults to `warn`; the adapter sets it explicitly because `debug` logs request bodies containing visitor text. Only IDs, outcome, model, confidence, route, and safe error codes are logged by platform code.
- A live round-trip with a dummy key confirmed transport, auth-header handling, and the 401 → `AI_MISCONFIGURED` mapping against the real API without transmitting visitor data. No valid-key classification run has been performed; formal accuracy calibration belongs to a later phase with a collected dataset.
- Data-retention terms for submitted ticket text were not verified in the public docs; review the TypeSafe retention policy before sending real visitor content in production.

The adapter asks for ticket type and severity from explicit choice sets. Define normalized `confidence` as the provider probability of the selected **type** label; preserve the SDK's separate reported confidence as provider metadata. If the selected-label probability is missing, malformed, or out of range, the result is invalid and goes to review rather than receiving an invented value. Use one request for related bounded questions when supported by the installed SDK. Question wording is versioned as `triage-v1` and fixture labels as `triage-fixtures-v1` so evaluation results can be compared over time. The official SDK documents both `choice` and per-label `probabilities`. [SDK response types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts)

## Routing and escalation policy

Classification is a recommendation. Code maps `question` to support, `feature_request` to product, `spam` to quarantine, and `bug` to engineering; other types stay in support/manual review until their workflows exist. The visitor's selected category is a hint only. If type and hint conflict, preserve both for the owner; do not automatically give the hint precedence.

Automatic GitHub issue creation requires a validated `bug` classification, normalized confidence at least 0.90, an active project GitHub connection, safe publication content, and no owner override blocking escalation. Component labels come from configured mappings, never arbitrary model text. An uncertain result, detected sensitive data, or missing integration leaves the ticket visible for review. Severity may affect ordering but does not override privacy or confidence gates.

## Failure and prompt security

The ticket is stored before AI work. A timeout, 4xx/5xx response, malformed answer, or exhausted retry changes work status and leaves the ticket in `needs_triage`; it does not delete the report or mark it spam. A generative failure uses the deterministic issue template. An invalid draft is not published. The dashboard shows the failure state and offers owner re-triage.

Visitor text is untrusted data, even if it says to ignore instructions, reveal a key, target another repository, or invent a classification. The adapter sends only task-relevant fields. No model receives GitHub credentials or tools that can mutate GitHub. Server policy selects the repository and performs the issue call after validation. Logs should capture IDs, outcome, version, latency, and safe error category, not raw visitor text or provider request bodies.

## Evaluation

Maintain a labeled fixture set with bug, feature, question, spam, ambiguous, prompt-injection, privacy-sensitive, and multi-project cases. Measure type confusion, false GitHub escalations, abstention/review rate, and confidence calibration. The initial 0.90 escalation threshold is a policy hypothesis, not a claim of calibrated accuracy; require fixture review and an optional live Jev evaluation before enabling automatic issue creation in the demo. CI tests use a fake classifier and recorded normalized responses; live provider tests are opt-in and require a server-side key. Version fixture labels and investigate regressions when model or question wording changes.

Phase 5 implements this as `triage-fixtures-v1` (7 cases: the 4 core fixtures plus ambiguous, category-disagreement, and critical-bug) with `pnpm ai:evaluate` running the mock classifier (must pass 7/7, gates CI) or live Jev (observations only, never gates). `pnpm ai:triage` classifies real `needs_triage` tickets from the database with either classifier.
