# Phase 3 handoff — internal support widget

## Completed

- Added an internal React widget package and consumed it through `@ai-support-platform/widget` in `apps/demo`.
- Implemented launcher, topic selection, message/contact form, validation, pending, failure/retry, confirmation, and close/reopen states.
- Added light, dark, and system themes; bottom-right and bottom-left placement; compact mobile sizing; and a controlled demo failure toggle.
- Added component and Playwright tests without network, database, AI, or GitHub dependencies.
- Updated architecture, decisions, security, testing, README, and agent instructions. No ticket API or backend write was added.

## Widget public API

```tsx
import { SupportWidget, type SupportSubmissionClient } from "@ai-support-platform/widget";

const client: SupportSubmissionClient = {
  submit: async (input) => ({ reference: "SUP-DEMO-001" }),
};

<SupportWidget projectKey="pk_..." submissionClient={client} />;
```

`SupportWidgetProps` also accepts `position` (`bottom-right`/`bottom-left`), `theme` (`light`/`dark`/`system`), a subset of `categories`, `title`, and `defaultOpen`. Visible categories are `question`, `bug`, and `feature_request`; the backend will treat them as hints. The submission contract carries project key, category, message, optional name/email, and a browser-generated idempotency key. Retry of unchanged draft content reuses the key. A successful result supplies a reference; the demo returns a visibly fake `SUP-DEMO-###` reference.

## Structure and styling

```text
packages/widget/src/index.ts                 Public exports and React client boundary
packages/widget/src/types.ts                 Public configuration/submission types
packages/widget/src/validation.ts            Zod form schema
packages/widget/src/support-widget.tsx       UI, form, focus, theme, adapter call
packages/widget/src/styles.ts                Bundled ShadowRoot stylesheet
packages/widget/src/support-widget.test.tsx  Component behavior tests
apps/demo/app/                               Mock consumer and theme/failure controls
e2e/widget.spec.ts                           Desktop and mobile browser flows
```

The package builds independently with `tsc`, emitting JavaScript and declarations in ignored `dist/`. React/React DOM are peer dependencies. React Hook Form, its Zod resolver, and Zod are package dependencies. There is no import from Next.js, `apps/*`, `packages/db`, or server environment variables. The demo imports only the package export.

Styles are bundled as text in the package entry and injected into an open ShadowRoot, so external consumers will not need Tailwind configuration or a CSS import. The fixed host applies safe-area spacing. Local CSS variables resolve light/dark/system modes. ADR-015 records this decision and its Content Security Policy implication: a strict host CSP may block the injected style; validate a compatible styling delivery before npm publication.

## Accessibility and privacy

The panel is a labeled nonmodal dialog. Opening focuses the first category; category choice focuses the message field; closing or Escape restores launcher focus. It has labeled inputs, visible focus rings, associated validation errors, a live confirmation status, and no keyboard focus trap. The close and submit controls are disabled during an in-flight request. The privacy copy says the report and optional contact details go to the site owner. It makes no claim that reports become public GitHub issues. The mock never transmits or stores data outside the demo page.

## Verification

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm dev` | Both apps ready; widget watch compiled with zero errors; stopped with Ctrl-C |
| `pnpm --filter @ai-support-platform/widget build` | Passed; JavaScript and declarations emitted |
| `pnpm lint` | Passed after formatting |
| `pnpm typecheck` | Passed for tooling, widget, apps, and database package |
| `pnpm test` | Passed: 6 tests across 2 files, including 5 widget cases |
| `pnpm test:db` | Passed: existing 6 PostgreSQL integration cases |
| `pnpm build` | Passed for widget and both Next.js apps |
| `pnpm test:e2e` | Passed: 3 Chromium cases including desktop bug and mobile dark failure/retry |
| `git diff --check` | Passed; no whitespace errors |

A local Brave browser showed the desktop light demo and support launcher. The browser's Grammarly extension caused a Next.js development hydration warning by adding attributes to `<body>` before hydration; production build and Playwright flows passed in clean Chromium. The mobile dark form/confirmation and viewport bounds were verified by Playwright. Manual screen-reader review and strict-CSP consumer testing remain for hardening/publication.

## Architecture changes and deviations

ADR-015 records Shadow DOM styling and the required submission-client boundary. These implement the Phase 0 widget boundary rather than changing the overall architecture. The package remains private and internal. No server API, database write, classifier, GitHub action, webhook, dashboard, authentication, or npm publication was added.

## Known issues and deferred work

- The demo mock is the only submission client. Its support references are fake; Phase 4 must supply a real public HTTP adapter and server-side idempotency fingerprinting.
- A strict Content Security Policy may block the injected style. Test a separate consumer with strict CSP before npm publication; choose external stylesheet delivery or a nonce strategy if required.
- A standalone external install, bundle-size budget, screen-reader pass, and publication-quality theming contract remain for Phase 10–11.
- Root `pnpm dev` builds the widget first and watches its source, while `pnpm dev:demo` performs an initial build only. Restart the demo-only command after package-source edits.
- Generated `packages/widget/dist/` is ignored by Git and Biome; source files are the reviewable package content.
- The Next.js Webpack workaround from ADR-009 remains in place. CI has not yet run on this uncommitted phase.

## Exact starting point for Phase 4

After owner approval, add a public ticket ingestion route in `apps/web` with Zod validation, body/rate/origin controls, project lookup, and the Phase 2 transactional repository call. Compute the request fingerprint on the server. Add a browser-safe HTTP `SupportSubmissionClient` adapter and switch the demo to it only after the API works, retaining mock tests for deterministic CI. Do not add Jev, GitHub calls, webhooks, dashboard, or authentication ahead of their phases.
