# Phase 12 handoff — npm publication preparation and IssueRelay rename

Owner decisions (2026-09-28):

- **Product name:** IssueRelay.
- **npm:** org `issuerelay`, owned by the personal account `andrewbaisden`; package `@issuerelay/widget`.
- **License and first version:** MIT, first version `0.1.0`.
- **Release model:** tag-driven releases with trusted publishing.
- **Repository:** renamed to `issuerelay`.

Deployment inputs (Vercel, Neon Postgres, Resend from the owner's domain) are recorded for the deployment phase and not implemented here.

## Delivered

- **Package identity.** `packages/widget` is `@issuerelay/widget@0.1.0`, no longer private. It has MIT `LICENSE`, `description`, `repository` (with `directory`), `homepage`, `bugs`, `keywords`, `files`, `exports` (plus `./package.json`), and `publishConfig: { access: "public", provenance: true }`. The demo and root scripts use the new name. The internal `@ai-support-platform/*` packages keep their names (ADR-026).
- **Release pipeline.**
  - `.github/workflows/release-widget.yml` runs on `widget-v*` tags. It checks the tag matches the version, runs lint, typecheck, unit tests, and `pnpm test:package`, then `npm publish`es the verified tarball with provenance through OIDC. No npm token is stored.
  - `docs/RELEASING.md` covers the one-time manual first publish, trusted-publisher setup, later releases, registry verification, and rollback.
- **Rebrand.**
  - Root `LICENSE` (MIT). The README is rewritten as a public IssueRelay landing page.
  - The web app title and heading are updated, and its stale "Foundation … later phases" home copy is replaced with a dashboard link.
  - The published issue footer now reads "Reported through IssueRelay." The reconciliation marker `ai-support-ticket:` is deliberately unchanged, so existing issues still reconcile.
  - AGENTS, ARCHITECTURE, DECISIONS (ADR-015/016 amendments, ADR-026, deployment inputs), SECURITY, TESTING, DEVELOPMENT, PRODUCT_SPEC, and ROADMAP are updated. Historical handoffs and reviews are unchanged.

## Verification

| Command | Actual result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed (now includes the widget's own typecheck) |
| `pnpm test` | Passed |
| `pnpm test:db`, `pnpm test:ai`, `pnpm test:github` | Passed |
| `pnpm build` | Passed |
| `pnpm test:e2e` | Passed |
| `pnpm test:package` | Passed |
| `git diff --check` | Passed |

Exact counts are in the commit report for this phase.

## Not done: owner actions

1. **First publish of `0.1.0`.** npm needs the maintainer's login and 2FA. This machine is not logged in (`npm whoami` → `ENEEDAUTH`). Follow `docs/RELEASING.md` → *First release*.
2. **After the first publish.** Configure the trusted publisher on npmjs.com (repository `andrewbaisden/issuerelay`, workflow `release-widget.yml`, environment `npm`), then install from the registry in a clean app to verify.

## Exact next phase starting point

After the first publish and owner approval, the deployment phase covers:

- Vercel project for `apps/web`, with Neon Postgres from the Vercel Marketplace (`DATABASE_URL`, pooled connections sized with `DATABASE_POOL_MAX`);
- production secrets (the startup guard enforces them);
- Resend email verification and password reset behind an `EmailSender` port with a new ADR, plus SPF/DKIM on the sending domain;
- the GitHub App webhook URL on the production host;
- scheduled `pnpm db:retention`.

Portfolio installation follows deployment.
