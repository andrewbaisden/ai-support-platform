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

## Verification (local, 2026-09-28)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed (a first attempt in a batch script failed without output and did not reproduce) |
| `pnpm lint` | Passed (225 files) |
| `pnpm typecheck` | Passed |
| `pnpm test` | 30 files, 180 tests passed |
| `pnpm test:db` | 6 files, 26 tests passed |
| `pnpm test:ai` | 6 passed |
| `pnpm test:github` | 17 passed |
| `pnpm db:check` | Passed |
| `pnpm build` | Passed (web and demo) |
| `pnpm test:e2e` | 23 passed, including `self-hosting.spec.ts` (setup 404 on the seeded server; wrong token rejected; owner created; key and snippet shown; setup closed afterwards; sign-in; key copy; origin add/invalid/remove persisted; not-installed connect with install link; mock connect) |
| `pnpm test:package` | 2 passed |
| `git diff --check` | Clean |
| Domain scan | The owner's personal domain does not appear in the repository |

`pnpm github:create-app` was smoke-tested locally: the manifest content is correct, and a wrong-state callback returns 400 with no file written. Creating a real App through it is part of the fresh-deploy proof.

## Not yet done: fresh-deploy proof

The plan's proof step needs the owner to deploy a **new**, separate instance by following only `docs/SELF_HOSTING.md`: button → Root Directory → Neon → secrets → `/setup` → `pnpm github:create-app` → App variables → redeploy → install the App on `ai-support-platform-live-test` → connect in Settings. Then run the live journey against that deployment with `--allow-remote-database`, fix any doc step that differs from reality, and update this handoff and the ROADMAP row to Complete. Production (`issuerelay-web`) and its GitHub App stay untouched; the test deployment, Neon database, and App can be deleted afterwards.

To confirm during the proof:

- whether Vercel's clone screen offers Root Directory;
- the Neon store prompt, and that its variable names are `DATABASE_URL`/`DATABASE_URL_UNPOOLED`;
- that the fallback auth URL signs in at `<project>.vercel.app`.

## Known limits and follow-ups

- One App serves one deployment. A project connects to one repository, and disconnecting is still an operator task.
- Setup closes permanently after the first account. A lost owner is recovered with `pnpm setup:production` or through the database.
- Without `TYPESAFE_API_KEY`, triage uses fixtures. The owner must record a **Recommend** decision before creating an issue (existing provenance rule; documented in the guide).
- Hosted multi-tenant IssueRelay (public sign-up, invitations, billing) is future work and not planned yet.
