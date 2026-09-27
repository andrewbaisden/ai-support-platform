"use client";

import {
  HttpSupportSubmissionClient,
  type SupportSubmissionClient,
  SupportWidget,
  type WidgetPosition,
  type WidgetTheme,
} from "@ai-support-platform/widget";
import { useRef, useState } from "react";

export default function DemoPage() {
  const [mode, setMode] = useState<"mock" | "real">("mock");
  const [theme, setTheme] = useState<WidgetTheme>("light");
  const [position, setPosition] = useState<WidgetPosition>("bottom-right");
  const [failSubmissions, setFailSubmissions] = useState(false);
  const [lastRequest, setLastRequest] = useState("");
  const sequence = useRef(0);

  const mockClient: SupportSubmissionClient = {
    async submit(input) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (failSubmissions) throw new Error("Demo failure");
      sequence.current += 1;
      setLastRequest(`${input.category}: ${input.message}`);
      return {
        reference: `SUP-DEMO-${String(sequence.current).padStart(3, "0")}`,
      };
    },
  };
  const apiBaseUrl =
    process.env.NEXT_PUBLIC_SUPPORT_API_URL ?? "http://127.0.0.1:3000";
  const submissionClient: SupportSubmissionClient =
    mode === "real"
      ? new HttpSupportSubmissionClient({ apiBaseUrl })
      : mockClient;

  return (
    <div className={`demo ${theme === "dark" ? "demo-dark" : ""}`}>
      <main>
        <div className="demo-badge">Controlled consumer</div>
        <h1>Demo Consumer</h1>
        <p className="demo-intro">
          A standalone website using the support widget through its workspace
          package export. Try the categories, switch themes, and simulate a
          failed submission.
        </p>

        <section className="demo-card" aria-labelledby="demo-controls-title">
          <div>
            <p className="demo-kicker">Widget lab</p>
            <h2 id="demo-controls-title">Consumer settings</h2>
          </div>
          <div className="demo-controls">
            <label htmlFor="mode">Submission mode</label>
            <select
              id="mode"
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as "mock" | "real")
              }
            >
              <option value="mock">Mock (no database)</option>
              <option value="real">Real local API</option>
            </select>
            <label htmlFor="theme">Theme</label>
            <select
              id="theme"
              value={theme}
              onChange={(event) => setTheme(event.target.value as WidgetTheme)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
            <label htmlFor="position">Position</label>
            <select
              id="position"
              value={position}
              onChange={(event) =>
                setPosition(event.target.value as WidgetPosition)
              }
            >
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
            </select>
            {mode === "mock" && (
              <label className="demo-check">
                <input
                  type="checkbox"
                  checked={failSubmissions}
                  onChange={(event) => setFailSubmissions(event.target.checked)}
                />
                Simulate submission failure
              </label>
            )}
          </div>
        </section>

        <section className="demo-note" aria-label="Demo result">
          <span className="demo-status">
            {mode === "mock" ? "Local mock only" : "Local API"}
          </span>
          <p>
            {lastRequest
              ? `Last accepted demo request: ${lastRequest}`
              : "No demo request submitted yet."}
          </p>
        </section>
      </main>
      <SupportWidget
        projectKey={`pk_${"A".repeat(32)}`}
        submissionClient={submissionClient}
        theme={theme}
        position={position}
      />
    </div>
  );
}
