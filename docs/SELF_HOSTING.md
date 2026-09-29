# Self-hosting IssueRelay

Run your own IssueRelay platform on Vercel and Neon, then add the widget to your site from npm. Expect about 15 minutes. Every service here has a free tier that covers a personal site.

What you end up with:

- **Your platform** (`https://<your-project>.vercel.app`): the ticket API the widget posts to, a dashboard for reviewing reports, and the GitHub webhook.
- **Your database** (Neon PostgreSQL): tickets, accounts, and GitHub links. Nothing is sent to the IssueRelay author.
- **Your GitHub App**: creates issues only in repositories you install it on, and only when you click **Create GitHub issue**.
- **The widget** (`@issuerelay/widget` from npm) on your React site, pointed at your platform.

## 1. Before you start

- A GitHub account, a Vercel account (Hobby is fine), and a React site where you can add a component.
- For the optional GitHub App command in step 4: Node.js 24 and pnpm 11 locally.
- A way to make random secrets: `openssl rand -base64 32` (macOS/Linux), or any password manager's generator (32+ characters).

## 2. Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fandrewbaisden%2Fissuerelay&project-name=issuerelay&repository-name=issuerelay&env=BETTER_AUTH_SECRET%2CCRON_SECRET%2CSETUP_TOKEN&envDescription=Three%20random%20secrets.%20Generate%20each%20with%3A%20openssl%20rand%20-base64%2032.%20SETUP_TOKEN%20unlocks%20the%20one-time%20%2Fsetup%20page%3B%20delete%20it%20after%20setup.&envLink=https%3A%2F%2Fgithub.com%2Fandrewbaisden%2Fissuerelay%2Fblob%2Fmain%2Fdocs%2FSELF_HOSTING.md%232-deploy&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%7D%5D)

1. Click **Deploy with Vercel**. Vercel copies this repository into your GitHub account.
2. **Add the Neon database** when prompted. It creates `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct), which the build uses to create the schema.
3. **Fill in the three secrets**, each a different random value of 32+ characters:

   | Variable | Purpose |
   | --- | --- |
   | `BETTER_AUTH_SECRET` | Signs dashboard sessions. Changing it signs everyone out. |
   | `CRON_SECRET` | Authenticates the daily data-retention job. |
   | `SETUP_TOKEN` | Unlocks the one-time `/setup` page. Delete it after step 3. |

4. Deploy. **This first deploy fails** with `No Output Directory named "public" found`, and that is expected: the clone screen has no Root Directory setting, so Vercel builds the top of the repository instead of the platform in `apps/web`.
5. **Set the Root Directory, then redeploy:**
   1. In the new project, open **Settings → Build and Deployment** and scroll down to **Root Directory** (below the framework settings).
   2. Enter `apps/web`, keep **Include files outside the root directory in the Build Step** on (the platform uses the repository's shared packages), and click **Save**.
   3. On the same page, check that **Framework Preset** is **Next.js** with no Output Directory override (the repository's `apps/web/vercel.json` pins it; copies made before that pin need it set by hand), and that **Node.js Version** is **24.x**.
   4. Open **Deployments**, click **⋯** on the failed deployment, and choose **Redeploy**.

   This build applies the database migrations first (`pnpm db:migrate` appears in the log before `next build`), so it creates every table.

You do not need to set `BETTER_AUTH_URL`: on Vercel it defaults to your project's production address (`https://<project>.vercel.app`). Set it only if you add a custom domain, and always open the dashboard at that production address (not a per-deployment `…-abc123.vercel.app` URL), or sign-in is refused.

Optionally set `DATABASE_POOL_MAX=2` (each serverless instance keeps a small pool; the default is 5).

## 3. First-run setup

1. Open `https://<your-project>.vercel.app/setup`.
2. Enter your `SETUP_TOKEN`, your name, email, and a password of 16+ characters, then name your site and give its address (for example `https://www.example.com`; add both the `www` and bare forms if you use both).
3. The page shows your **widget key** and ready-to-paste widget code. You can find both again later under **Settings**.
4. **Delete `SETUP_TOKEN`** from the Vercel environment variables. The setup page closes for good once an account exists, but removing the token keeps it closed even if the database is ever reset.
5. Sign in at `/login`.

The setup page only works while the database has no accounts *and* `SETUP_TOKEN` is set, so nobody who finds your URL first can claim your platform.

## 4. Create the GitHub App

The App lets the dashboard create issues in your repository and keeps each report's status in sync when you close or reopen the issue. Choose one way.

### Option A: one command

Clone your copy of the repository (the one Vercel created in your GitHub account) and run the command **inside that folder** (Node.js 24, pnpm 11):

```sh
git clone https://github.com/<you>/<your-repository>.git
cd <your-repository>
pnpm install
pnpm github:create-app --platform https://<your-project>.vercel.app
```

Your browser opens GitHub with everything filled in: a private App with **Issues: read and write** and **Metadata: read-only**, subscribed to the **Issues** event, with its webhook pointing at `https://<your-project>.vercel.app/api/webhooks/github`. Click **Create GitHub App**. The command writes the App ID, private key, and webhook secret to `.env.github-app.local` (git-ignored) and never prints them. Add `--org <name>` to create the App under an organization.

### Option B: by hand

On GitHub: **Settings → Developer settings → GitHub Apps → New GitHub App**.

1. **Name:** anything, e.g. `IssueRelay my-site`. **Homepage URL:** your platform URL.
2. **Webhook:** active. **URL:** `https://<your-project>.vercel.app/api/webhooks/github`. **Secret:** a new random value of 32+ characters.
3. **Repository permissions:** **Issues → Read and write**. Metadata becomes read-only automatically. Leave everything else as *No access*.
4. **Subscribe to events: tick Issues.** This is easy to miss; without it, closing an issue on GitHub never updates the ticket.
5. **Where can this App be installed:** *Only on this account*. Create it.
6. On the App's page, note the **App ID** and click **Generate a private key** (a `.pem` file downloads).

### Add the App to Vercel

In **Vercel → Project → Settings → Environment Variables** (Production), add:

| Variable | Value |
| --- | --- |
| `GITHUB_APP_ID` | The App ID |
| `GITHUB_APP_PRIVATE_KEY` | The whole private key, including the `BEGIN`/`END` lines (pasting the multi-line PEM works; `\n` escapes also work) |
| `GITHUB_WEBHOOK_SECRET` | The webhook secret |

Redeploy (**Deployments → ⋯ → Redeploy**) so the platform picks them up, then delete `.env.github-app.local` or the downloaded `.pem`.

## 5. Connect your repository

These are two separate steps: installing the App gives it access on GitHub, and connecting tells IssueRelay which repository this project's issues go to.

1. **Install the App** on the repository that should receive issues: open the App on GitHub → **Install App** → your account → **Only select repositories** → pick it.
2. **Connect it in IssueRelay:** in the dashboard, open your project's **Settings** (the **Settings** link on the project card, or **Project settings** above the ticket list). Under **GitHub repository**, enter the repository as `owner/name` and click **Connect**. The section changes to **Connected to owner/name**. If the App is not installed there yet, the page tells you and links to the install screen.

A project connects to one repository. Settings is also where you copy the widget key and add or remove allowed site addresses.

## 6. Add the widget to your site

```sh
npm install @issuerelay/widget
```

Paste the widget code from **Settings** into a client component and render it on every page (for example in your root layout). It already contains your platform URL and widget key. The widget key is public identification, not a secret; your platform only accepts reports from the site addresses listed in Settings.

See the [widget README](../packages/widget/README.md) for theming, position, and options.

## 7. Your first report

1. Send a test report from your site with the widget.
2. It appears in the dashboard under your project. Open it.
3. To turn it into a GitHub issue:
   - **With AI triage** (optional, see below): click **Re-run AI triage**. A confident bug classification enables **Create GitHub issue**.
   - **Without AI triage:** under *Human review decision*, set *GitHub escalation recommendation* to **Recommend** and click **Record decision**. Then **Create GitHub issue**.
4. **Preview issue content** shows exactly what will be published. Contact details and the raw conversation are never sent to GitHub.
5. Close the issue on GitHub and the ticket moves to *Resolved*; reopen it and the ticket returns to *Queued*.

## Optional features

- **AI triage (Jev):** set `TYPESAFE_API_KEY` (from [TypeSafe](https://typesafe.ai)) and redeploy. Jev receives only the report message and category, never contact details. Review TypeSafe's data-retention terms before sending real visitor reports.
- **Account email** (verification and password reset): set `RESEND_API_KEY` and `EMAIL_FROM` together (for example `IssueRelay <no-reply@mail.your-domain>`) after verifying a sending domain in [Resend](https://resend.com). Without email, sign-in works and there is no password reset, so keep your password in a password manager.

## Updating

Pull changes from the upstream repository into your copy (GitHub's **Sync fork**, or `git pull https://github.com/andrewbaisden/issuerelay main`) and push. Vercel redeploys, and the production build applies any new migrations before serving the new version. Migrations are additive, so a rollback in Vercel still works with the schema.

## What is stored where

| Where | What |
| --- | --- |
| Neon (your database) | Tickets and reports, the optional visitor email and name, accounts, AI classifications, and GitHub links |
| GitHub (your repository) | Only the issue you choose to create: a sanitized summary, never contact details or the raw report |
| TypeSafe (only if enabled) | The report message and category hint, for classification |
| The visitor's browser | Nothing beyond the open widget |

A daily job erases visitor names and emails from tickets resolved more than 180 days ago and deletes processed webhook records older than 90 days.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Build ends with `No Output Directory named "public" found` | Vercel built the repository root. Set **Root Directory** to `apps/web` (Settings → Build and Deployment, scroll down), save, and redeploy (step 2). |
| Build fails with `DATABASE_URL_UNPOOLED is required` | Connect the Neon database to the project (Storage tab), then redeploy. |
| The site shows a server error after deploy | Check the deployment's runtime logs: the startup check names any unsafe or missing setting (never its value), e.g. a secret shorter than 32 characters. |
| Build succeeds at `apps/web` but still says `No Output Directory named "public"` | Set **Framework Preset** to **Next.js** and turn off any Output Directory override, then redeploy. |
| `/setup` returns 404 | An account already exists, or `SETUP_TOKEN` is not set. Sign in at `/login` instead. |
| Sign-in fails or loops | Open the production address, not a per-deployment URL. With a custom domain, set `BETTER_AUTH_URL` to it and redeploy. |
| The widget says it could not send | Add your site's exact address (scheme, host, and port) in **Settings → Allowed site addresses**. |
| Tickets show "No GitHub repository is connected" | Installing the App is not enough: connect the repository in the project's **Settings** (step 5). |
| "GitHub is not configured on this deployment" | Add the three App variables and redeploy. |
| Closing the issue does not resolve the ticket | The App must subscribe to the **Issues** event, and `GITHUB_WEBHOOK_SECRET` must equal the App's webhook secret. The App's **Advanced** tab lists deliveries and their responses (401 means the secrets differ). |

For day-to-day operations (rollback, rotating secrets, retention, GitHub recovery), see [DEPLOYMENT.md](DEPLOYMENT.md) and [GITHUB_RECOVERY.md](GITHUB_RECOVERY.md).
