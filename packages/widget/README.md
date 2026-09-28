# @issuerelay/widget

An embeddable React support widget for [IssueRelay](https://github.com/andrewbaisden/issuerelay). Visitors can ask a question, report a bug, or suggest a feature without leaving your site. Reports go to your IssueRelay platform, where they are triaged and, after review, can become GitHub issues.

- Renders inside a Shadow DOM: no Tailwind setup, no CSS import, no clashes with your styles.
- Works under a strict Content Security Policy (no `'unsafe-inline'` styles needed in current browsers).
- Light, dark, or system theme; bottom-right or bottom-left placement.
- Accessible: labelled controls, focus management, Escape to close, announced errors.
- Ships as ESM with TypeScript types and a `"use client"` entry for the Next.js App Router.

## Install

```sh
npm install @issuerelay/widget
# or
pnpm add @issuerelay/widget
```

React 19 and React DOM 19 are peer dependencies.

## Usage

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

In the Next.js App Router, render the widget from your own client component (as above) because the submission client is created in the browser.

### Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `projectKey` | `string` | required | Public project identifier from your IssueRelay dashboard. It is not a secret and grants no access. |
| `submissionClient` | `SupportSubmissionClient` | required | Usually `HttpSupportSubmissionClient`; implement the interface yourself for tests or custom transport. |
| `theme` | `"light" \| "dark" \| "system"` | `"system"` | `system` follows `prefers-color-scheme`. |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | |
| `categories` | `SupportCategory[]` | all | Any of `"question"`, `"bug"`, `"feature_request"`. |
| `title` | `string` | | Panel heading. |
| `defaultOpen` | `boolean` | `false` | |

### `HttpSupportSubmissionClient`

`new HttpSupportSubmissionClient({ apiBaseUrl, timeoutMs?, fetchImpl? })` posts to `POST {apiBaseUrl}/api/v1/support/tickets` without cookies or credentials. Failures reject with `HttpSubmissionError`, whose `code` is a public error code (for example `RATE_LIMITED`, `ORIGIN_NOT_ALLOWED`) or `TIMEOUT`, `NETWORK_ERROR`, or `INVALID_RESPONSE`. Retries of the same unchanged report reuse one idempotency key, so a visitor never creates duplicate tickets.

## Host requirements

- Allow your IssueRelay platform origin in `connect-src` if your site sets a Content Security Policy, and add your site's origin to the project's allowed origins in IssueRelay.
- Styles use constructable stylesheets (`adoptedStyleSheets`). Browsers without them (for example Safari before 16.4) fall back to a `<style>` element in the ShadowRoot, which a strict `style-src` would block.

## Privacy

The widget sends only the visitor's message, selected category, and optional name and email to your platform. Contact details stay private in IssueRelay and are never published to GitHub. No API keys or secrets are ever needed in the browser.

## License

[MIT](./LICENSE)
