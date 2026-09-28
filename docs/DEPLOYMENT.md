# Deployment

IssueRelay's platform (`apps/web`: public ticket API, dashboard, auth, GitHub webhook, retention cron) runs on **Vercel** with **Neon** PostgreSQL and **Resend** for account email. The widget is not deployed here; websites install it from npm. The demo app is not deployed.

Production: `https://issuerelay-web.vercel.app` (Vercel project `issuerelay-web`, root directory `apps/web`, Node.js 24).

## How a deploy works

Every push to `main` deploys production. `apps/web/vercel.json` sets the build to `scripts/vercel-build.mjs`:

1. **Migrate (production builds only).** When `VERCEL_ENV=production`, the build runs `pnpm db:migrate` over the direct connection `DATABASE_URL_UNPOOLED`, applying the checked-in, reviewed migrations. Preview builds never migrate. Migrations must stay additive, so a failed build or a rollback still has a compatible schema.
2. **Build.** It builds `@ai-support-platform/support-contracts`, then `@ai-support-platform/web` (webpack).
3. **Start.** Each server instance runs the startup guard (`apps/web/instrumentation.ts`), which refuses to serve with unsafe configuration and names the setting, never its value.

A cron job (`/api/cron/retention`, daily at 03:00 UTC) applies the retention policy; Vercel authenticates it with `CRON_SECRET`.

## Environment variables (Vercel, Production)

Vercel stores these as sensitive: `vercel env pull` returns them withheld, so production secrets never land on developer machines by accident.

| Variable | Source | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Neon integration | **Pooled** URL (`-pooler` host) for the running app |
| `DATABASE_URL_UNPOOLED` | Neon integration | Direct URL, used only by production builds to migrate |
| `DATABASE_POOL_MAX` | Set manually | `2`: each serverless instance keeps a small pool |
| `BETTER_AUTH_SECRET` | Generated | Unique to production (`openssl rand -base64 32`); never the example value |
| `BETTER_AUTH_URL` | Set manually | `https://issuerelay-web.vercel.app` (must be `https://`) |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` | GitHub App | Full PEM; real newlines or `\n` both work |
| `GITHUB_WEBHOOK_SECRET` | GitHub App | Must equal the App's webhook secret (32+ characters) |
| `TYPESAFE_API_KEY` | TypeSafe | Jev triage; without it triage uses fixtures, which cannot escalate |
| `CRON_SECRET` | Generated | 32+ characters; required by the startup guard |
| `RESEND_API_KEY`, `EMAIL_FROM` | Resend | Set together; enables email verification and password reset |

Never set `GITHUB_ESCALATION_MOCK`, `AUTH_ALLOW_SIGNUP=true` (until invitations or sign-up are deliberately enabled), `DATABASE_URL_TEST`, or `SEED_OWNER_*` in production. The other variables the Neon integration adds (`PG*`, `POSTGRES_*`) are unused and harmless.

## First-time setup

1. Import the repository into Vercel with root directory `apps/web`, and add Neon from Vercel's Storage tab (Marketplace).
2. Add the variables above and deploy. The first production build creates the schema.
3. Create the owner, workspace, and projects **without demo data**. Never run `pnpm db:seed` against production. Run this in your own terminal, so the password and database URL stay out of logs and shared sessions:

   ```sh
   read -rs "DATABASE_URL?Neon direct URL: "; echo; export DATABASE_URL
   read -rs "OWNER_PASSWORD?Owner password (16+ chars): "; echo; export OWNER_PASSWORD
   export OWNER_EMAIL="<an address you control>"
   pnpm setup:production --workspace "IssueRelay" --project "<site name>" --slug <slug> \
     --origin https://<site> --origin https://www.<site> --yes
   unset DATABASE_URL OWNER_PASSWORD
   ```

   The owner is created already verified. Re-running reuses existing rows and never changes a password; adding a project for an existing owner needs only `OWNER_EMAIL`. Owner credentials are read only from the command's environment, never from `.env`, so keep production passwords in a password manager rather than in local env files. The output includes each project's public widget key.
4. Point the GitHub App webhook at `https://issuerelay-web.vercel.app/api/webhooks/github` with the same secret as `GITHUB_WEBHOOK_SECRET`, subscribed to **Issues**. Connect a project to a repository with `pnpm github:connect` using the production database URL.
5. Email: in Resend, verify a sending subdomain by adding its DKIM TXT and send MX/SPF records at the domain's DNS host. No website or hosting is needed on the subdomain; with Netlify DNS, the record name is relative, e.g. `resend._domainkey.mail`. Set `RESEND_API_KEY` and `EMAIL_FROM` (`IssueRelay <no-reply@mail.<domain>>`) and redeploy. The login page then shows **Forgot your password?**, and sign-in requires a verified email.

## Keep local and production apart

- Local `.env` must point at local PostgreSQL. Seed, migrate, the E2E harness, and local dev servers all read it.
- Keep production access in the git-ignored `.env.production.local` and load it only into a single deliberate command. The live runner additionally requires `--allow-remote-database` and an `https://` platform.

## Validate a deploy

```sh
export DATABASE_URL="<production URL from .env.production.local>"
LIVE_GITHUB_TEST=1 pnpm github:live-journey --repository andrewbaisden/ai-support-platform-live-test \
  --project <live validation project id> --platform https://issuerelay-web.vercel.app \
  --classifier jev --allow-remote-database
```

This uses a dedicated validation project connected to the disposable repository, never a customer site's project. To check only the webhook secret, redeliver an old `issues` delivery from the App's Advanced tab: production should answer 200 `ignored` (401 means the secrets differ).

## Operations

- **Rollback:** use Vercel's *Instant Rollback* to a previous deployment. Additive migrations stay compatible; a destructive change needs its own reviewed migration and plan.
- **Rotate secrets:** update the value in Vercel (and in GitHub for the webhook secret, or Resend for the API key), then redeploy. Rotating `BETTER_AUTH_SECRET` signs everyone out.
- **Retention:** the Vercel dashboard (Settings → Cron Jobs) shows runs; logs record `retention_applied` counts. `pnpm db:retention` performs the same work by hand (dry run unless `--apply`).
- **GitHub recovery:** see [GITHUB_RECOVERY.md](GITHUB_RECOVERY.md).
- **Local webhook testing:** the App's single webhook URL now points to production. Use a separate development GitHub App for tunnel testing.
