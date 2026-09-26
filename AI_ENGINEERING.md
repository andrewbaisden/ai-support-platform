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

Use the official TypeSafe JavaScript SDK, `@typesafe-ai/sdk`, server-side on Node.js. Its documented API creates `TypeSafeClient`, calls `systemOne({ state, questions })`, and defines bounded questions with helpers such as `choice`. Keep those calls entirely inside `JevTicketClassifier`; application services see only the normalized contract. Do not use an OpenAI-compatible chat route or assume Jev generates prose. Recheck the SDK version and documentation during Phase 5 because this integration is still new. [Official SDK quickstart](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/README.md), [SDK types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts)

The adapter asks for ticket type and severity from explicit choice sets. Define normalized `confidence` as the provider probability of the selected **type** label; preserve the SDK's separate reported confidence as provider metadata. If the selected-label probability is missing, malformed, or out of range, the result is invalid and goes to review rather than receiving an invented value. Use one request for related bounded questions when supported by the installed SDK. Version the question wording and criteria so evaluation results can be compared over time. The official SDK documents both `choice` and per-label `probabilities`. [SDK response types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/main/src/types.ts)

## Routing and escalation policy

Classification is a recommendation. Code maps `question` to support, `feature_request` to product, `spam` to quarantine, and `bug` to engineering; other types stay in support/manual review until their workflows exist. The visitor's selected category is a hint only. If type and hint conflict, preserve both for the owner; do not automatically give the hint precedence.

Automatic GitHub issue creation requires a validated `bug` classification, normalized confidence at least 0.90, an active project GitHub connection, safe publication content, and no owner override blocking escalation. Component labels come from configured mappings, never arbitrary model text. An uncertain result, detected sensitive data, or missing integration leaves the ticket visible for review. Severity may affect ordering but does not override privacy or confidence gates.

## Failure and prompt security

The ticket is stored before AI work. A timeout, 4xx/5xx response, malformed answer, or exhausted retry changes work status and leaves the ticket in `needs_triage`; it does not delete the report or mark it spam. A generative failure uses the deterministic issue template. An invalid draft is not published. The dashboard shows the failure state and offers owner re-triage.

Visitor text is untrusted data, even if it says to ignore instructions, reveal a key, target another repository, or invent a classification. The adapter sends only task-relevant fields. No model receives GitHub credentials or tools that can mutate GitHub. Server policy selects the repository and performs the issue call after validation. Logs should capture IDs, outcome, version, latency, and safe error category, not raw visitor text or provider request bodies.

## Evaluation

Maintain a labeled fixture set with bug, feature, question, spam, ambiguous, prompt-injection, privacy-sensitive, and multi-project cases. Measure type confusion, false GitHub escalations, abstention/review rate, and confidence calibration. The initial 0.90 escalation threshold is a policy hypothesis, not a claim of calibrated accuracy; require fixture review and an optional live Jev evaluation before enabling automatic issue creation in the demo. CI tests use a fake classifier and recorded normalized responses; live provider tests are opt-in and require a server-side key. Version fixture labels and investigate regressions when model or question wording changes.
