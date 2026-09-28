"use client";

import {
  type SupportSubmissionClient,
  SupportWidget,
  type WidgetPosition,
} from "@issuerelay/widget";

const stubClient: SupportSubmissionClient = {
  async submit() {
    return { reference: "SUP-EXT-2" };
  },
};

export function Support({ position }: { position: WidgetPosition }) {
  return (
    <SupportWidget
      projectKey={`pk_${"N".repeat(32)}`}
      submissionClient={stubClient}
      theme="dark"
      position={position}
    />
  );
}
