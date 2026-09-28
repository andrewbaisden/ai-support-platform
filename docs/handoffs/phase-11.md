# Phase 11 handoff — external widget package validation

Owner-approved on 2026-09-28. Plan approved as proposed:

1. Bundle the contracts into the widget.
2. Test the packed tarball in external consumers.
3. Test a strict-CSP host.
4. Finalize the public API and install guide.

## Delivered

- **Self-contained build.** `packages/widget` builds with tsup 8.5.1: one ESM entry with `"use client"`, and bundled declarations. The contracts are inlined; the package's only runtime imports are React and react-hook-form. The declarations import only `react`. The widget's own `typecheck` is now part of the root gate; it exposed and fixed two stale mock typings in an existing test.
- **Strict-CSP styling.** The ShadowRoot adopts a shared constructable stylesheet before its first portal render, so supporting browsers never insert a blockable `<style>`; older browsers fall back to `<style>` (ADR-015 amendment).
- **No Zod in the browser.** The strict-CSP test found a real problem. Zod 4 probes `new Function` while building object schemas, and strict-CSP hosts report that probe as a violation even though Zod catches it (its own source says so). Setting Zod's global `jitless` flag would have changed the host app's Zod behaviour. Instead, the contracts gained a dependency-free `./constants` entry. The widget validates forms and reads responses with small checks built on it, and `contract-parity.test.tsx` proves they agree with the server's Zod schemas on 270 form combinations and 12 response shapes (ADR-016 amendment). As a result the widget dropped `zod` and `@hookform/resolvers` from its dependencies.
- **`pnpm test:package`.** It does five things:
  - packs the real tarball;
  - asserts its exact five files and a clean manifest: public, MIT, no `workspace:` ranges, no devDependencies (stripped by `.pnpmfile.cjs`);
  - enforces an import allowlist and scans for eval, `process.env`, Node built-ins, platform packages, credential environment names, and key material;
  - copies `package-check/consumers/{vite,next}` outside the workspace, installs the tarball with npm, and builds both, the Vite build with `tsc` and `skipLibCheck: false`;
  - runs Playwright against the Vite host (strict CSP, no `'unsafe-inline'`) and the Next.js App Router host (server render and hydration).
- **Consumer documentation.** A consumer README at `packages/widget/README.md` covers install, usage, props, the HTTP client, host requirements (CSP `connect-src`, allowed origins), privacy, and license.

## Verification

| Command | Actual result |
| --- | --- |
| `pnpm test:package` | Passed. Tarball 10.5 KB, 5 files. Vite host behind a strict CSP: styled via adopted stylesheet with no `<style>` element, submission succeeded, **0 CSP violations**. Next.js host: SSR and hydration, dark theme, submission succeeded, no console errors. The first two runs failed on consumer-fixture typing and Next's own declarations under `skipLibCheck: false` (fixture fixes). The third failed on the Zod eval probe (the product fix above). |
| Widget unit tests | 12 passed (10 existing, unchanged, plus 2 parity tests) |
| Full gate | See the Phase 12 handoff; run once for both phases |

## Known limits

- React 19 only (peer dependency). React 18 support would need its own test matrix.
- ESM only. No CommonJS build; every modern bundler and Next.js consume ESM.
- Browsers without `adoptedStyleSheets` (Safari before 16.4) need `'unsafe-inline'` styles under a strict CSP.
- `pnpm test:package` needs network access for the consumers' npm installs.
