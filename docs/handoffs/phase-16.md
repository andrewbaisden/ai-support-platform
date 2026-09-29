# Phase 16 handoff — self-hosted IssueRelay

Owner-approved on 2026-09-28. Goal: anyone can deploy their own IssueRelay platform on Vercel and Neon in about 15 minutes, with no terminal or database access needed after deploying, and then install `@issuerelay/widget` against it. The widget is unchanged. Decision record: ADR-028. Deployer guide: [SELF_HOSTING.md](../SELF_HOSTING.md).

## What changed

- **First-run setup (`/setup`, `POST /api/setup`).**
  - The setup form creates the owner, workspace, and first project, then shows the full widget key and ready-to-paste widget code.
  - It works only while the database has no accounts **and** `SETUP_TOKEN` (32+ characters) is set. The token is compared in constant time, requests must be same-origin, and the page returns 404 otherwise.
  - The logic lives in `packages/auth/src/bootstrap.ts` (`bootstrapInstallation`), which `pnpm setup:production` now also uses.
  - The workspace, membership, and project are created in one repository transaction (`bootstrapWorkspaceProject`, `countUsers`).
  - The setup auth instance sends no email and creates no session.
- **Project settings (`/dashboard/projects/<id>/settings`).**
  - Members see the full key with a copy button, the install snippet, the allowed origins, and the connected repository.
  - Owners edit through `POST /api/dashboard/projects/<id>/settings`:
    - `origins` replaces the allowed-origin list (validated; at most 20; new `updateProjectAllowedOrigins`);
    - `connect` resolves `owner/name` with the new `lookupRepositoryInstallation` and stores the repository identity GitHub reports.
  - If the App isn't installed on the repository, the page links to its install screen (`fetchAppInstallUrl`).
  - The page is linked from the project card and the ticket list.
- **`pnpm github:create-app --platform https://<deployment>`.** Registers a private GitHub App from a manifest:
  - Issues read/write, Metadata read, the **Issues** event, and the webhook URL all preset;
  - a one-shot `127.0.0.1` callback checks a random `state`;
  - credentials go to the git-ignored `.env.github-app.local` (mode 0600) and are never printed.
- **Deploy to Vercel button** in the README and the guide. It clones the whole repository, adds the Neon store (`integrationSlug`/`productSlug` `neon`), and prompts for `BETTER_AUTH_SECRET`, `CRON_SECRET`, and `SETUP_TOKEN`.
  - The button has no documented root-directory parameter, and a `repository-url` subdirectory would clone only `apps/web` and break the workspace. The guide therefore tells deployers to set Root Directory to `apps/web`.
- **`BETTER_AUTH_URL` is optional on Vercel.** `resolveAuthBaseUrl` falls back to `https://$VERCEL_PROJECT_PRODUCTION_URL`, and the startup guard uses the same resolution.
- **Fixes found along the way.**
  - The shared `originSchema` threw `TypeError: Invalid URL` on non-URL input, because Zod 4 still runs refinements after a failed `z.url()` check. It now returns a validation failure.
  - The setup form's hints sat inside the `<label>` elements, polluting each input's accessible name. Hints now use `aria-describedby`.
- **Documentation:**
  - new: `docs/SELF_HOSTING.md`, ADR-028, and a README "Deploy your own" section;
  - updated: ROADMAP (Phase 16, plus future hosted multi-tenant), ARCHITECTURE, SECURITY, TESTING, DEVELOPMENT, and AGENTS.
- **E2E harness.**
  - A third platform server on `127.0.0.1:3102` (`.next-e2e-setup`, `SETUP_TOKEN` set) runs against `support_platform_setup_e2e`, which global setup drops, recreates, and migrates (without seeding) on every run.
  - It uses a new `db:e2e recreate` command.
  - `.next-e2e-setup` is ignored by git and Biome.

## Verification (local; re-run 2026-09-29 after the proof fixes)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed (earlier batch-script "failures" were the script itself: zsh passed `install --frozen-lockfile` as one argument) |
| `pnpm lint` | Passed (226 files) |
| `pnpm typecheck` | Passed |
| `pnpm test` | 30 files, 180 tests passed |
| `pnpm test:db` | 6 files, 27 tests passed (including `withExplicitSslMode`) |
| `pnpm test:ai` | 6 passed |
| `pnpm test:github` | 17 passed |
| `pnpm db:check` | Passed |
| `pnpm build` | Passed (web and demo) |
| `pnpm test:e2e` | 23 passed twice in a row after raising the per-test timeout to 60s (the intermittent failure was `dashboard.spec.ts` "operator resolves a ticket" hitting the 30s default while three dev servers compile; it passed 3/3 alone), including `self-hosting.spec.ts` (setup 404 on the seeded server; wrong token rejected; owner created; key and snippet shown; setup closed afterwards; sign-in; key copy; origin add/invalid/remove persisted; not-installed connect with install link; mock connect) |
| `pnpm test:package` | 2 passed |
| `git diff --check` | Clean |
| Domain scan | The owner's personal domain does not appear in the repository |

`pnpm github:create-app` was smoke-tested locally: the manifest content is correct, and a wrong-state callback returns 400 with no file written. Creating a real App through it is part of the fresh-deploy proof.

## Fresh-deploy proof (2026-09-29)

The owner deployed a new, separate instance by following `docs/SELF_HOSTING.md`: Vercel project `issuerelay-selfhost-check`, a new Neon database, and a new GitHub App created with `pnpm github:create-app`, installed only on `ai-support-platform-live-test`. Production (`issuerelay-web`) and its App were not touched.

**What happened, and what changed as a result:**

| Step | Reality | Fix |
| --- | --- | --- |
| Deploy button | Cloned the repository and added Neon; the clone screen has **no Root Directory setting** | Guide: the first deploy is expected to fail; set Root Directory, then redeploy |
| First build | `No Output Directory named "public" found`: Vercel built the repository root | Troubleshooting quotes the error |
| After setting Root Directory | Migrations ran (the build used `apps/web/vercel.json`), but the build failed the same way: the framework preset had been fixed at **Other** when the project was created | `apps/web/vercel.json` pins `"framework": "nextjs"`; the guide says to check the preset for copies made before the pin |
| `/setup` | Worked; the owner and project were created; setup then returned 404 | None |
| `pnpm github:create-app` | First run happened outside the repository (`Command not found`) | Guide shows clone → `cd` → run |
| App name | `IssueRelay issuerelay-selfhost-check` was cut to `issuerelay-issuerelay-selfhost-che` | The default name drops a leading `issuerelay-` from the host (`IssueRelay selfhost-check`) |
| Connect | Installing the App was taken for connecting; logs showed no settings request | Guide makes install and connect two named steps, with a troubleshooting row |
| Runtime logs | Every request logged pg's `sslmode` alias warning at error level, which looks like a failure | Connections spell out `sslmode=verify-full` for pg's aliases (same certificate checks; verified TLS with an authorized certificate against Neon, with no warning) |

Verified from here:

- **Routes:** `/`, `/login`, and `/setup` returned 200 before setup; `/dashboard` redirected to sign-in; cross-origin `POST /api/setup` returned 403; the unauthenticated cron returned 401; `/setup` returned 404 after setup.
- **Webhook:** a signed ping returned 200 `processed`; an unsigned request was rejected.
- **App scope:** installed on the live-test repository only.
- **Database:** one owner, one project, and one integration after connecting.

**Live journey:** `pnpm github:live-journey --repository andrewbaisden/ai-support-platform-live-test --project <self-host project> --platform https://issuerelay-selfhost-check.vercel.app --classifier mock --operator-email <owner> --allow-remote-database`, using the new deployment's database and App credentials and no TypeSafe key. **20/20 checks passed:**

- submit and idempotent retry (`SUP-1`);
- fixture triage and the owner recommendation, i.e. the no-AI path the guide documents;
- preview; creation of [issue #13](https://github.com/andrewbaisden/ai-support-platform-live-test/issues/13) by `issuerelay-issuerelay-selfhost-che[bot]`;
- a repeat create reusing the link;
- no private data, allowlisted labels, marker, and a single remote issue;
- close → resolved; reopen → queued; a redelivered close changing nothing;
- the full timeline; finished closed.

The owner may now delete the test Vercel project, its Neon database, the `issuerelay-issuerelay-selfhost-che` App, and the local `.env.selfhost-check.local` and `.env.github-app.local` files.

## Owner review of the guide (2026-09-29)

| Feedback | Change |
| --- | --- |
| Say where the setup token is | Setup step: it was created at deploy time and is under **Settings → Environment Variables** |
| "Next steps" after `create-app` was unclear, and "your repository" was vague | Browser page and terminal say **next setup phase**; step 2 names the repository of the website or app where the widget goes, installed with *Only select repositories*; a fourth line points to `TYPESAFE_API_KEY` |
| `example.com` gave no hint what to enter; a wrong address only shows "We couldn't send your message" | The setup form defaults to `http://localhost:3000` and explains local, Vercel, and custom-domain addresses; Settings explains the same and quotes the widget's error; the guide and troubleshooting cover it |
| Jev was listed as optional, but GitHub issues cannot be created without it | Jev moved into step 4 as required for issues (key from the TypeSafe console; credit shown at the time of writing, with the console as the source for current terms); step 7 and troubleshooting say reports stay in the dashboard without it; the project Settings page warns when `TYPESAFE_API_KEY` is missing |

The $5.00 starting credit is what the owner's new TypeSafe console showed; TypeSafe's public site and docs do not state free-credit terms (the homepage lists Jev at $42 per billion input tokens), so the guide cites the console rather than promising an amount.

## Known limits and follow-ups

- One App serves one deployment. A project connects to one repository, and disconnecting is still an operator task.
- Setup closes permanently after the first account. A lost owner is recovered with `pnpm setup:production` or through the database.
- **GitHub issues need `TYPESAFE_API_KEY`.** Without it, "Re-run AI triage" uses the keyword fixture classifier, a test double: most real reports fall back to `other` at 0.62, below the 0.9 bug threshold, and an owner recommendation cannot raise confidence. The proof's live journey passed with fixture triage only because its synthetic message matches a bug keyword. The guide originally presented Jev as optional with a "Recommend" workaround; owner review corrected that (see below).
- Octokit logs a deprecation notice for the issue create/update endpoints, scheduled for removal on 2028-03-10 under the pinned API version; move to the newer REST API version before then.
- Hosted multi-tenant IssueRelay (public sign-up, invitations, billing) is future work and not planned yet.
