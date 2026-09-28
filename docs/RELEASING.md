# Releasing @issuerelay/widget

The widget is the only published package. Everything else in the monorepo (`@ai-support-platform/*`) is private platform code. Contract constants are bundled into the widget, and nothing else is published.

## Accounts

- npm user: `andrewbaisden` (personal account, owner of the org).
- npm organization: `issuerelay` (free tier, public packages), which provides the `@issuerelay` scope.
- The organization UI's **Teams → Add Existing Package** only assigns permissions for a package that already exists. The package is created by the first publish.

## What a release contains

`pnpm test:package` builds the exact tarball `npm publish` uploads and verifies it:

- Five files only: `package.json`, `README.md`, `LICENSE`, `dist/index.js`, `dist/index.d.ts`.
- Manifest: name `@issuerelay/widget`, MIT, no `private`, no `workspace:` ranges, no devDependencies (stripped by `.pnpmfile.cjs`).
- Code: `"use client"` entry; imports only `react`, `react-dom`, `react/jsx-runtime`, `react-hook-form`. No `eval`/`new Function`, `process.env`, Node built-ins, platform packages, environment names, or key material.
- Behaviour: installed from the tarball into a Vite app (strict CSP, TypeScript `skipLibCheck: false`) and a Next.js App Router app, both outside the workspace; Playwright submits a report in each, and the strict-CSP page must record no violations.

## First release (0.1.0), once, by hand (done 2026-09-28)

npm trusted publishing can be configured only for a package that exists, so the first version is published from a maintainer machine.

```sh
npm login                         # as andrewbaisden (2FA)
npm whoami                        # expect: andrewbaisden
pnpm install --frozen-lockfile
pnpm test:package                 # must pass; prints the tarball location
npm publish "$(node -p "require('node:path').join(require('node:os').tmpdir(), 'issuerelay-package-check', 'issuerelay-widget.tgz')")" \
  --access public --provenance=false
```

`--provenance=false` is needed only here: provenance attestations can be generated only in CI, and the manifest requests them by default for later releases.

Then:

1. On npmjs.com → `@issuerelay/widget` → **Settings → Trusted publishing**, add GitHub Actions with repository `andrewbaisden/issuerelay`, workflow `release-widget.yml`, and environment `npm`.
2. Optionally require 2FA and disallow token publishing in the same settings page.
3. Verify from the registry (below).

## Later releases

1. Update `packages/widget/package.json` `version` (semver; breaking changes bump the minor version while below 1.0) and note the change in the pull request.
2. Merge to `main`, then tag and push: `git tag widget-v0.1.1 && git push origin widget-v0.1.1`.
3. `.github/workflows/release-widget.yml` checks the tag matches the version, runs lint, typecheck, unit tests, and `pnpm test:package`, then publishes the verified tarball with provenance through OIDC. No npm token is stored.

## Verify from the registry

Run the release checks against the published tarball itself. This downloads the version from npm, checks the registry's sha512 integrity hash, and repeats every tarball check and both external-consumer tests:

```sh
PACKAGE_CHECK_VERSION=0.1.0 pnpm test:package
```

To also confirm the published files match `main`, compare them with a fresh `pnpm pack` of the widget.

A quick manual check also works, in a clean directory outside the repository:

```sh
npm create vite@latest widget-check -- --template react-ts
cd widget-check && npm install && npm install @issuerelay/widget
```

Render `SupportWidget` with a stub `submissionClient`, run `npm run build`, open the page, and submit a report. The registry package must behave like the tarball. `npm view @issuerelay/widget` should show the version, MIT license, and (from the second release onward) provenance.

## If a release is wrong

- Publish a fixed patch version; do not reuse version numbers.
- `npm deprecate @issuerelay/widget@<version> "<reason>"` warns installers.
- `npm unpublish` is limited to 72 hours and to packages without dependents; prefer deprecation.
- If a secret was ever published, rotate it first. Unpublishing does not remove copies already downloaded.
