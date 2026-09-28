# Phase 13 handoff — portfolio installation

Owner-approved on 2026-09-28. `@issuerelay/widget@0.1.0` from npm runs on the owner's portfolio site (Next.js 16 App Router on Netlify, repository `andrewbaisden/andrew-baisden-portfolio`). Reports go to the production **Portfolio** project, which is connected to that repository for escalation.

## Portfolio changes (portfolio repository, three commits)

1. **`chore(deps)`: React 18 → 19.** The App Router already rendered with Next's bundled React 19 canary; only unit tests used the installed React 18, while `@types/react` was already 19, which broke the portfolio's rule against mixing majors. Its lint, typecheck, unit (26), build, and E2E (6) suites all passed on 19 before the widget was added.
2. **`feat(support)`: the widget.**
   - A client wrapper mounted once in the root layout: bottom-right, titled "How can I help?", following the site's light/dark theme.
   - `src/lib/support-widget-config.ts` holds the public production API URL and project key, with `NEXT_PUBLIC_ISSUERELAY_*` overrides for local testing.
   - A unit test covers the key, client, position, and theme switching. An E2E test submits through the real widget with the IssueRelay API (including the CORS preflight) stubbed, and asserts the request.
   - The portfolio's `AGENTS.md` and `.env.example` are updated.
   - pnpm 12's `minimumReleaseAge` got a single pinned exclusion for `@issuerelay/widget@0.1.0`, which was published the same day.
3. **`fix(hero)`: dev calibrators.** The dev-only scene calibrators overlapped the launcher in the bottom-right corner (development only; they never render in production). They are raised above it, and bounding boxes were measured to confirm no overlap on desktop or mobile, collapsed or expanded.

## IssueRelay changes

- **Production Portfolio project** (`12c30f46-ee21-44d5-936b-9278b18d79a9`). It was created with `pnpm setup:production`, because the owner's earlier setup run had not created it. Allowed origins are the site's apex and `www` origins; a CORS preflight check returned 204 for the site and 403 for another origin.
- **`setup:production` fix** (`5330430`). It read `OWNER_PASSWORD` from the local `.env`, where a production password had been kept, so a throwaway-database test created an account with it without being asked. That database was dropped. Credentials are now read only from the command's environment, and a password is required only to create a new owner.
- **GitHub.** The owner added the portfolio repository to the App installation. `pnpm github:connect` linked the project (repository `432486002`, installation `165479139`), and the escalation-time `verifyRepository` check passed against the stored ID.

## Verification

| Check | Result |
| --- | --- |
| Portfolio gate | install, lint, typecheck, unit 27, build, E2E 7 passed; CI passed on `main` |
| Deployment | Netlify serves the widget config in the live layout bundle; a headless browser opened the live widget with no page errors (nothing submitted) |
| Owner's live test | Three reports from the live site: `SUP-2` question → support, `SUP-3` bug → engineering, `SUP-4` feature request → product. Jev classified all three as the visitor intended (0.95–1.00, `model` provenance). |
| Escalation to the real repository | `SUP-3` → issue #3 on `andrew-baisden-portfolio`, created by `ai-support-platform-dev[bot]` with the `bug` label (the repository has no `severity:*` labels). The visitor's name and email, both on file, are **absent** from the public issue; one marker line, no internal IDs. |
| Local end-to-end demo | Portfolio dev server with overrides → local IssueRelay → local dashboard, with the portfolio's local origin allowed on the local Portfolio Demo project only |

## Notes and follow-ups

- The portfolio repository is public: escalated issues are public. Keep reviewing each preview; the privacy gate is a heuristic.
- Optional: add `severity:high` / `severity:critical` labels to the repository, so escalations carry severity instead of recording `github_labels_omitted`.
- The widget's minimum-release-age exclusion can be removed from the portfolio once 0.1.0 is older than pnpm's threshold.
- The GitHub App is still named `ai-support-platform-dev`; renaming it to IssueRelay is cosmetic (the bot login would change, and reconciliation reads the current slug from `GET /app`).
- Remaining roadmap items (dogfooding) are ongoing use rather than a build phase.
