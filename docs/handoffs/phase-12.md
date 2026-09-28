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

## Publication

- **`@issuerelay/widget@0.1.0` published by the owner (`andrewbaisden`) on 2026-09-28.** Registry metadata shows:
  - 5 files and MIT license;
  - only `react-hook-form` as a dependency, React 19 as peers;
  - no devDependencies;
  - no provenance attestation, as expected for the manual first publish.
- **Verification from the registry.** `PACKAGE_CHECK_VERSION=0.1.0 pnpm test:package` passed. It downloaded the tarball (sha512 integrity matched the registry), repeated every tarball check, and passed both external consumers: strict-CSP Vite with 0 violations, and the Next.js App Router host.
- **The published files match `main`.** All five are byte-identical to a fresh `pnpm pack` of the widget.
- **Registry caching after publish.** The full package document (`/@issuerelay%2fwidget`) returned 404 from the registry CDN for a while after publishing, from cached pre-publish lookups, while `/@issuerelay/widget/latest` and search already showed 0.1.0. The registry check reads version metadata, so it is unaffected.

## Remaining owner action

Configure the trusted publisher on npmjs.com (repository `andrewbaisden/issuerelay`, workflow `release-widget.yml`, environment `npm`) before the next release; later releases then publish from `widget-v*` tags with provenance.

## Exact next phase starting point

After owner approval, the deployment phase covers:

- Vercel project for `apps/web`, with Neon Postgres from the Vercel Marketplace (`DATABASE_URL`, pooled connections sized with `DATABASE_POOL_MAX`);
- production secrets (the startup guard enforces them);
- Resend email verification and password reset behind an `EmailSender` port with a new ADR, plus SPF/DKIM on the sending domain;
- the GitHub App webhook URL on the production host;
- scheduled `pnpm db:retention`.

Portfolio installation follows deployment.
