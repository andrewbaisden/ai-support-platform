# Phase 0 handoff

## Completed

- Defined the product scope, MVP journey, non-goals, roadmap, domain model, monorepo boundaries, and trust boundaries.
- Recorded decisions for Drizzle, Better Auth, Jev isolation, GitHub App escalation, durable work, idempotency, and internal widget packaging.
- Specified AI fallback, privacy controls, test fixtures, phase gates, and agent instructions.

## Architecture changes

This is the initial architecture. Public widget submission stores a ticket and work item transactionally. A provider-neutral classifier proposes bounded judgments; application policy routes tickets. A GitHub App creates issues only for eligible high-confidence bugs, and signed webhooks synchronize linked issue state. One-owner access is the first live target, with workspace/project isolation in the domain.

## Files added or changed

`README.md`, `AGENTS.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `AI_ENGINEERING.md`, `SECURITY.md`, `TESTING.md`, and this handoff.

## Important implementation details

- Use the official `@typesafe-ai/sdk` server-side `TypeSafeClient.systemOne` API when Phase 5 begins; recheck current docs/version before installing.
- Initial automatic escalation confidence policy is 0.90, subject to labeled evaluation before live activation. Question answering is deferred; questions are routed to support.
- Use a Postgres-backed work/outbox table with leases for AI and GitHub work. An ambiguous GitHub create result needs repository-marker reconciliation before retry.
- Do not expose personal data in public issues; the issue body uses a publication-safe projection and a stable ticket marker.
- Use a disposable GitHub repository before any portfolio connection.

## Tests and verification

Phase 0 has no executable application tests, typecheck, lint, or build. `git diff --check` passed. All eight intended Markdown files exist, and a local Markdown-link target check found no missing local files. Repository status shows only Phase 0 documentation changes. Future commands are specified in `TESTING.md` but are not yet runnable.

## Known issues and implementation risks

- Jev provider output/confidence behavior must be validated against the installed SDK and representative labeled fixtures. The threshold may need calibration.
- GitHub issue creation lacks an application idempotency key; reconciliation avoids blind duplicate creation but may require owner intervention.
- PII redaction cannot be perfect; ambiguous reports must be reviewed before publication.
- A Postgres worker needs a concrete scheduler and operational alerting before deployment.
- Public widget endpoints require rate limiting and origin policy without treating either the project key or `Origin` as authentication.

## Deferred work and open inputs

No application code, package install, database, or CI exists yet. TypeSafe access is needed for an optional Phase 5 live test. A disposable GitHub repository and App registration are needed in Phase 7. Hosting/database provider and scheduler are selected before deployment. Package naming, public exports, portfolio integration, and article work occur in later phases.

## Next phase

After explicit approval, Phase 1 creates the minimal pnpm workspace, strict TypeScript/Next.js foundation, only necessary packages, environment validation, Biome, Vitest/Playwright infrastructure, basic GitHub Actions CI, and an initial demo app if it adds immediate value. Stop after acceptance commands pass and write `docs/handoffs/phase-01.md`.

## Commands to verify

```sh
git status --short
rg --files
rg 'Phase 0|Jev|GitHub|project' README.md AGENTS.md ARCHITECTURE.md DECISIONS.md AI_ENGINEERING.md SECURITY.md TESTING.md docs/handoffs/phase-00.md
```
