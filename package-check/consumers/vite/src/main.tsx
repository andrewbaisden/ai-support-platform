import {
  HttpSupportSubmissionClient,
  type SupportSubmissionClient,
  SupportWidget,
  type SupportWidgetProps,
} from "@issuerelay/widget";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// The real HTTP client must construct in a browser bundle without any
// platform code; the page submits through a local stub instead.
export const httpClient = new HttpSupportSubmissionClient({
  apiBaseUrl: "https://support.example.com",
});

const stubClient: SupportSubmissionClient = {
  async submit(input) {
    if (!input.projectKey.startsWith("pk_")) throw new Error("bad key");
    return { reference: "SUP-EXT-1" };
  },
};

const props: SupportWidgetProps = {
  projectKey: `pk_${"E".repeat(32)}`,
  submissionClient: stubClient,
  theme: "light",
  position: "bottom-right",
};

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(
  <StrictMode>
    <main>
      <h1>External Vite consumer</h1>
      <SupportWidget {...props} />
    </main>
  </StrictMode>,
);
