# @issuerelay/widget

An embeddable React support widget for [IssueRelay](https://github.com/andrewbaisden/issuerelay). Visitors can ask a question, report a bug, or suggest a feature without leaving your site. Reports go to your IssueRelay platform, where they are triaged and, after review, can become GitHub issues.

![The IssueRelay support widget open on a website, offering Ask a question, Report a bug, and Suggest a feature](https://raw.githubusercontent.com/andrewbaisden/issuerelay/main/docs/assets/support-widget-demo.png)

- Renders inside a Shadow DOM: no Tailwind setup, no CSS import, no clashes with your styles.
- Works under a strict Content Security Policy (no `'unsafe-inline'` styles needed in current browsers).
- Light, dark, or system theme; bottom-right or bottom-left placement.
- Accessible: labelled controls, focus management, Escape to close, announced errors.
- Ships as ESM with TypeScript types and a `"use client"` entry for the Next.js App Router.

## Before you start: your IssueRelay platform

The widget sends reports to an IssueRelay platform that you run, where your dashboard, AI triage, and GitHub connection live. Deploy your own on Vercel and Neon in about 15 minutes with the [self-hosting guide](https://github.com/andrewbaisden/issuerelay/blob/main/docs/SELF_HOSTING.md). Its first-run setup page gives you a **project key** and ready-to-paste widget code. You can find both again later on your project's **Settings** page in the dashboard.

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

Replace `apiBaseUrl` with your platform's address and `projectKey` with the key from your project's **Settings** page (which also shows this code with both filled in). In the Next.js App Router, render the widget from your own client component (as above), because the submission client is created in the browser. Render it once, for example in your root layout, so it appears on every page.

### Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `projectKey` | `string` | required | Public project identifier from your project's **Settings** page. It is not a secret and grants no access. |
| `submissionClient` | `SupportSubmissionClient` | required | Usually `HttpSupportSubmissionClient`; implement the interface yourself for tests or custom transport. |
| `theme` | `"light" \| "dark" \| "system"` | `"system"` | `system` follows `prefers-color-scheme`. |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | |
| `categories` | `SupportCategory[]` | all | Any of `"question"`, `"bug"`, `"feature_request"`. |
| `title` | `string` | | Panel heading. |
| `defaultOpen` | `boolean` | `false` | |

### `HttpSupportSubmissionClient`

`new HttpSupportSubmissionClient({ apiBaseUrl, timeoutMs?, fetchImpl? })` posts to `POST {apiBaseUrl}/api/v1/support/tickets` without cookies or credentials. Failures reject with `HttpSubmissionError`, whose `code` is a public error code (for example `RATE_LIMITED`, `ORIGIN_NOT_ALLOWED`) or `TIMEOUT`, `NETWORK_ERROR`, or `INVALID_RESPONSE`. Retries of the same unchanged report reuse one idempotency key, so a visitor never creates duplicate tickets.

## Host requirements

- **Allowed site addresses:** in your project's **Settings**, list every address the site runs on, matched exactly by scheme, host, and port: for example `http://localhost:3000` while developing a Next.js app, plus your live address (`https://my-site.vercel.app` or your own domain, with and without `www` if you use both). From any other address the platform refuses the report and the widget shows "We couldn't send your message. Please try again."
- Allow your IssueRelay platform origin in `connect-src` if your site sets a Content Security Policy.
- Styles use constructable stylesheets (`adoptedStyleSheets`). Browsers without them (for example Safari before 16.4) fall back to a `<style>` element in the ShadowRoot, which a strict `style-src` would block.

## Privacy

The widget sends only the visitor's message, selected category, and optional name and email to your platform. Contact details stay private in IssueRelay and are never published to GitHub. No API keys or secrets are ever needed in the browser.

## Links

- [IssueRelay on GitHub](https://github.com/andrewbaisden/issuerelay): the platform, dashboard, and documentation
- [Self-hosting guide](https://github.com/andrewbaisden/issuerelay/blob/main/docs/SELF_HOSTING.md)
- [Report a problem or suggest an improvement](https://github.com/andrewbaisden/issuerelay/issues)

## License

[MIT](./LICENSE)
