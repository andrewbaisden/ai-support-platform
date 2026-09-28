import { CopyField } from "./copy-field";

export function installSnippet(apiBaseUrl: string, projectKey: string) {
  return `// npm install @issuerelay/widget
"use client";

import {
  HttpSupportSubmissionClient,
  SupportWidget,
} from "@issuerelay/widget";

const submissionClient = new HttpSupportSubmissionClient({
  apiBaseUrl: "${apiBaseUrl}",
});

export function Support() {
  return (
    <SupportWidget
      projectKey="${projectKey}"
      submissionClient={submissionClient}
      theme="system"
      position="bottom-right"
    />
  );
}`;
}

/** Ready-to-paste widget code for this platform and project. */
export function InstallSnippet({
  apiBaseUrl,
  projectKey,
}: {
  apiBaseUrl: string;
  projectKey: string;
}) {
  return (
    <CopyField
      label="Widget code"
      value={installSnippet(apiBaseUrl, projectKey)}
      multiline
    />
  );
}
