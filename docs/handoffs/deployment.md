# Deployment handoff — Vercel, Neon, Resend

Owner-approved on 2026-09-28. The platform runs in production at `https://issuerelay-web.vercel.app`. The runbook is [docs/DEPLOYMENT.md](../DEPLOYMENT.md); the decisions are in ADR-027.

## Delivered

- **Vercel project `issuerelay-web`** (root `apps/web`, Node.js 24). `apps/web/vercel.json` runs `scripts/vercel-build.mjs`, which migrates Neon over `DATABASE_URL_UNPOOLED` on production builds only, then builds contracts and web. The build log of the first deploy shows `migrations applied successfully!`.
- **Neon** through the Vercel Marketplace: the pooled URL at runtime, with `DATABASE_POOL_MAX=2`, and the direct URL for migrations.
- **`pnpm setup:production`.** It creates a verified owner, a workspace, and projects with no demo data. It is idempotent, requires `--yes`, and never sends email or changes an existing password. It was verified on a throwaway database (a second run reused all rows) and run by the owner for two projects: the site and a separate **Live validation** project.
- **Email through Resend.** An `EmailSender` port with a fetch-based Resend adapter (no SDK). Better Auth sends verification and reset links, requires a verified email to sign in, and signs out all sessions on reset. There are **Forgot your password?**, `/forgot-password`, and `/reset-password` pages. It is all enabled only when `RESEND_API_KEY` and `EMAIL_FROM` are both set. The sending subdomain was verified with a DKIM TXT and send MX/SPF records at Netlify DNS (NS1); no hosting was needed.
- **Retention cron.** `/api/cron/retention` runs daily at 03:00 UTC and is authenticated with a timing-safe comparison of `Bearer $CRON_SECRET`. A generated `CRON_SECRET` was added to Vercel as a sensitive variable without being displayed.
- **Startup guard.** It now also requires `CRON_SECRET`, complete email settings, and email configuration before sign-up can be enabled.
- **Dashboard sign-out.** A defect found in production: there was no way to end a session, so the login page's reset link was unreachable while signed in. Fixed with a header **Sign out** button and an E2E test.
- **Live runner.** `--allow-remote-database` (with an `https://` platform) validates a deployment.

## Verification

| Check | Result |
| --- | --- |
| Local gate before deploy | install, lint, typecheck, unit 155, db 22, ai 6, github 17, migration check, build, E2E 19, package check passed |
| Production responses | `/`, `/login`, `/forgot-password` 200; webhook `GET` 405; cron without secret 401; HSTS, `frame-ancestors 'none'`, `X-Frame-Options: DENY` present |
| Startup guard in production | Served after all variables were set, including `CRON_SECRET` and the Resend pair |
| Email | Owner-run: forgot password → email from the verified subdomain → new password → sign in: **works** |
| Webhook secret | GitHub redelivery of an old `issues` delivery to production: HTTP 200 `ignored` |
| **Live journey against production** | **19/19 passed**. `SUP-1` in the Live validation project: production API submit and idempotent retry; Jev triage (bug, 1.00); issue #12 in the disposable repository with no private data, correct marker, bot author, single copy; close → resolved and reopen → queued through webhooks to Vercel and Neon; redelivered close a no-op (8→8 events); ordered timeline; finished closed |
| Sign-out fix | Dashboard and shell E2E 8/8 against the local E2E database; deployed (`e438b04`), CI passed |

## Findings during deployment

- **Vercel withholds sensitive variables** from `vercel env pull` (all values `[SENSITIVE]`). That drove the migrate-on-production-build design. The pulled file was deleted.
- **The local `.env` was pointed at production Neon** during owner setup. The E2E harness refused to run (its local `_e2e` guard), so nothing touched production. The owner restored `.env` to local PostgreSQL. [DEPLOYMENT.md](../DEPLOYMENT.md) now states the rule: production access only through `.env.production.local`.
- **`vercel link` appended `.env*` to `.gitignore`,** which would have hidden changes to `.env.example`. It was reverted; `.vercel` stays ignored.
- **The GitHub App webhook now points to production,** so local tunnel testing needs a separate development App.

## Known limits and next steps

- **Phase 13: portfolio installation.** Install `@issuerelay/widget` on the owner's site with the site project's widget key and `apiBaseUrl` `https://issuerelay-web.vercel.app`. Add the platform origin to the site's CSP `connect-src` if it sets one. Connect that project to the site's repository only when escalation to it is wanted.
- A custom domain and a product website are optional later decisions; changing domains means updating `BETTER_AUTH_URL`, the App webhook URL, and the npm `homepage`.
- Member invitations do not exist yet; sign-up stays closed.
- Preview deployments share production variables unless a Neon preview branch is configured. They never migrate, but they could read production data if opened; keep preview URLs private, or configure a Neon branch for previews.
