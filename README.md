# IssueRelay

> Turn website feedback into reviewed support tickets, and confirmed bugs into GitHub issues that stay in sync.

[![CI](https://github.com/andrewbaisden/issuerelay/actions/workflows/ci.yml/badge.svg)](https://github.com/andrewbaisden/issuerelay/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@issuerelay/widget?label=%40issuerelay%2Fwidget)](https://www.npmjs.com/package/@issuerelay/widget)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

![The IssueRelay support widget open on the demo website, showing question, bug, and feature request choices](docs/assets/support-widget-demo.png)

IssueRelay gives any website a support widget and gives you a private dashboard to handle what visitors send. Visitors ask a question, report a bug, or suggest a feature. Every report is stored before anything else runs. AI triage recommends a type and severity, and deterministic policy routes it. You review the result, and a confirmed bug becomes one GitHub issue. When the issue is closed or reopened on GitHub, the ticket follows.

```text
Visitor → @issuerelay/widget → IssueRelay API → Ticket → AI triage → Human review → GitHub issue
                                                                    ↖ signed webhook ↙
```

## Features

- **Embeddable widget.** A React component in a Shadow DOM: no Tailwind or CSS setup, no style clashes. It works under a strict Content Security Policy and in the Next.js App Router, with light, dark, or system themes.
- **Durable intake.** PostgreSQL stores every report before AI or GitHub runs. Idempotent submission, per-project rate limits, and origin checks.
- **Bounded AI triage.** [Jev](https://typesafe.ai) (or an offline fixture) recommends type and severity from the message only. Code owns routes, thresholds, and anything that is published.
- **Human review.** An authenticated, workspace-scoped dashboard with classification history, overrides kept separate from AI decisions, and owner-only publishing.
- **GitHub, carefully.** A GitHub App creates an issue only after an owner confirms a privacy-screened preview. Contact details never leave IssueRelay. Retries reconcile instead of duplicating.
- **Two-way sync.** Signed webhooks close and reopen tickets. Replays, stale deliveries, and early closes are handled.
- **Production guardrails.** Required same-origin requests, safe redirects, a startup check for unsafe secrets, security headers, and a retention command.

## Deploy your own

Run your own IssueRelay platform on Vercel and Neon in about 15 minutes, all on free tiers:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fandrewbaisden%2Fissuerelay&project-name=issuerelay&repository-name=issuerelay&env=BETTER_AUTH_SECRET%2CCRON_SECRET%2CSETUP_TOKEN&envDescription=Three%20random%20secrets.%20Generate%20each%20with%3A%20openssl%20rand%20-base64%2032.%20SETUP_TOKEN%20unlocks%20the%20one-time%20%2Fsetup%20page%3B%20delete%20it%20after%20setup.&envLink=https%3A%2F%2Fgithub.com%2Fandrewbaisden%2Fissuerelay%2Fblob%2Fmain%2Fdocs%2FSELF_HOSTING.md%232-deploy&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%7D%5D)

1. **Deploy** with the button: add the Neon database and fill in three random secrets. The first build fails until you set Root Directory to `apps/web` in the project settings and redeploy.
2. **Set up** at `/setup`: create the owner account and your first project, and copy the widget key.
3. **Connect GitHub:** `pnpm github:create-app --platform https://<your-app>` creates a correctly configured GitHub App; then connect your repository from the project's **Settings**.
4. **Install the widget** on your site with the code from Settings.

The step-by-step guide, including a no-terminal GitHub App option and troubleshooting, is in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## Add the widget to a site

```sh
npm install @issuerelay/widget
```

```tsx
"use client";

import {
  HttpSupportSubmissionClient,
  SupportWidget,
} from "@issuerelay/widget";

const submissionClient = new HttpSupportSubmissionClient({
  apiBaseUrl: "https://your-issuerelay-platform.example",
});

export function Support() {
  return (
    <SupportWidget
      projectKey="pk_your_public_project_key_000000000"
      submissionClient={submissionClient}
      theme="system"
      position="bottom-right"
    />
  );
}
```

Use your platform's URL and the project key from its **Settings** page. The project key identifies a project; it is not a secret. See the [widget README](packages/widget/README.md) for props, host requirements, and privacy details.

## Run the platform locally

Use Node.js 24, pnpm 11.5.3, and Docker (PostgreSQL 16):

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Set `SEED_OWNER_EMAIL` and `SEED_OWNER_PASSWORD` in `.env` before seeding to sign in to the dashboard. The example Better Auth secret and owner password are for local use only; replace them before exposing the app anywhere. Open the platform at `http://127.0.0.1:3000` and the demo website at `http://127.0.0.1:3001`. [Development setup](docs/DEVELOPMENT.md) covers AI triage with Jev, connecting a GitHub App, and webhooks.

## How it works

| Step | What happens |
| --- | --- |
| Submit | The widget posts to the public API. The platform validates, rate-limits, and stores the conversation, message, and ticket in one transaction. |
| Triage | Jev classifies the message into a bounded type and severity. Policy picks the route; only confident bugs backed by the model or an owner's recommendation are eligible for GitHub. |
| Review | An operator inspects the report, the AI decision, and its history, and can override it with a recorded reason. |
| Escalate | The owner previews the exact issue. A privacy gate blocks contact details and credentials. Confirmation creates one issue with an opaque marker. |
| Sync | Signed GitHub webhooks move the ticket to resolved or back to queued, in order and exactly once. |

## Tech stack

Next.js 16 · React 19 · TypeScript · PostgreSQL + Drizzle · Better Auth · Zod · Jev (TypeSafe SDK) · GitHub App (Octokit) · Vitest · Playwright · Biome · pnpm workspaces

## Testing

```sh
pnpm lint && pnpm typecheck && pnpm test   # unit and component
pnpm test:db && pnpm test:ai && pnpm test:github   # PostgreSQL integration
pnpm test:e2e       # browser journeys against an isolated database
pnpm test:package   # packs the widget and tests it in external Vite and Next.js apps
```

Live checks against a real GitHub App are opt-in and limited to disposable repositories. See [TESTING.md](TESTING.md).

## Documentation

- [Architecture](ARCHITECTURE.md), [decisions](DECISIONS.md), [security](SECURITY.md), [AI engineering](AI_ENGINEERING.md), [testing](TESTING.md)
- [Product specification](docs/PRODUCT_SPEC.md), [roadmap](docs/ROADMAP.md), [development](docs/DEVELOPMENT.md), [self-hosting](docs/SELF_HOSTING.md), [deployment](docs/DEPLOYMENT.md), [releasing](docs/RELEASING.md)
- [GitHub recovery runbook](docs/GITHUB_RECOVERY.md), [phase handoffs](docs/handoffs/), and [reviews](docs/reviews/)

## Status

The full journey, from widget to GitHub and back, has been validated live against a disposable repository. The widget is published on npm as [`@issuerelay/widget`](https://www.npmjs.com/package/@issuerelay/widget) (0.1.0), and the published tarball passed the same external-consumer and strict-CSP checks as the build. The platform is deployed on Vercel with Neon PostgreSQL and Resend email, and the full journey passed live against production. The widget now runs on the author's portfolio site, where real reports are triaged and confirmed bugs become issues in its repository ([roadmap](docs/ROADMAP.md)).

## Responsible use

Visitor messages and contact details are private support data. AI makes bounded recommendations, human decisions stay separate from model history, and publishing to GitHub always needs an owner's confirmation. Confidence scores are not calibrated probabilities, and the privacy gate is a heuristic, so review every preview. Use synthetic data for live tests. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Andrew Baisden
