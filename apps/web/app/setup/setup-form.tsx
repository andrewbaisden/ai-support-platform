"use client";

import { useId, useState } from "react";
import { CopyField } from "../components/copy-field";
import { installSnippet } from "../components/install-snippet";

type Result = { projectName: string; publicKey: string };

const ERRORS: Record<string, string> = {
  INVALID_SETUP_TOKEN: "That setup token is not correct.",
  INVALID_REQUEST: "Check the details: passwords need at least 16 characters.",
  INVALID_INPUT: "Check the details: site URLs must be valid.",
  PASSWORD_REQUIRED: "Choose a password of at least 16 characters.",
  SETUP_UNAVAILABLE: "Setup is already complete. Sign in instead.",
  FORBIDDEN: "Open this page from the platform's own address.",
};

/** Accept full URLs and keep just the origin the API compares against. */
function toOrigins(text: string): string[] | undefined {
  const lines = text
    .split(/[\s,]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  try {
    return [...new Set(lines.map((line) => new URL(line).origin))];
  } catch {
    return undefined;
  }
}

export function SetupForm({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  if (result) {
    return (
      <div className="grid gap-5">
        <p role="status" className="text-sm text-emerald-800">
          IssueRelay is set up. Your project{" "}
          <strong>{result.projectName}</strong> is ready.
        </p>
        <CopyField label="Widget key (public)" value={result.publicKey} />
        <CopyField
          label="Add the widget to your React site"
          value={installSnippet(apiBaseUrl, result.publicKey)}
          multiline
        />
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          Remove <code>SETUP_TOKEN</code> from your environment variables. This
          page is now closed either way.
        </p>
        <a
          className="w-fit rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          href="/login"
        >
          Sign in to the dashboard
        </a>
      </div>
    );
  }

  return (
    <form
      aria-label="Set up IssueRelay"
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const text = (name: string) => String(data.get(name) ?? "");
        if (text("ownerPassword") !== text("confirmPassword")) {
          setError("The passwords do not match.");
          return;
        }
        const allowedOrigins = toOrigins(text("sites"));
        if (!allowedOrigins || allowedOrigins.length === 0) {
          setError(
            "Enter your site's address, e.g. http://localhost:3000 or https://my-site.vercel.app.",
          );
          return;
        }
        setPending(true);
        setError(null);
        void fetch("/api/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: text("token"),
            ownerName: text("ownerName"),
            ownerEmail: text("ownerEmail"),
            ownerPassword: text("ownerPassword"),
            workspaceName: text("workspaceName"),
            projectName: text("projectName"),
            allowedOrigins,
          }),
        })
          .then(async (response) => {
            const payload = (await response.json().catch(() => null)) as
              | ({ ok: true } & Result)
              | { ok: false; error: string }
              | null;
            if (payload?.ok) setResult(payload);
            else
              setError(
                ERRORS[payload?.error ?? ""] ?? "Setup failed. Try again.",
              );
          })
          .catch(() => setError("Could not reach the server. Try again."))
          .finally(() => setPending(false));
      }}
    >
      <Field
        name="token"
        label="Setup token"
        type="password"
        hint="The SETUP_TOKEN value you set when deploying."
      />
      <fieldset className="grid gap-4 rounded border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">Owner account</legend>
        <Field name="ownerName" label="Your name" autoComplete="name" />
        <Field
          name="ownerEmail"
          label="Email"
          type="email"
          autoComplete="email"
          hint="Use an address you control; password resets go here."
        />
        <Field
          name="ownerPassword"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={16}
          hint="At least 16 characters."
        />
        <Field
          name="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          minLength={16}
        />
      </fieldset>
      <fieldset className="grid gap-4 rounded border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">First project</legend>
        <Field
          name="workspaceName"
          label="Workspace name"
          defaultValue="IssueRelay"
        />
        <Field
          name="projectName"
          label="Site name"
          hint="For example: My portfolio."
        />
        <div className="grid gap-1 text-sm">
          <label htmlFor="setup-sites">Site address</label>
          <textarea
            id="setup-sites"
            name="sites"
            required
            rows={2}
            defaultValue="http://localhost:3000"
            placeholder="http://localhost:3000"
            aria-describedby="setup-sites-hint"
            className="rounded border border-slate-300 px-3 py-2"
          />
          <span id="setup-sites-hint" className="text-xs text-slate-500">
            The addresses your site runs on; reports from anywhere else are
            refused. <code>http://localhost:3000</code> is where a Next.js app
            runs on your computer. Add your live address too, such as{" "}
            <code>https://my-site.vercel.app</code> or your own domain (with and
            without <code>www</code> if you use both). One per line; you can
            change these later in Settings.
          </span>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Setting up…" : "Set up IssueRelay"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  hint,
  type = "text",
  ...input
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  minLength?: number;
  defaultValue?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1 text-sm">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        required
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="rounded border border-slate-300 px-3 py-2"
        {...input}
      />
      {hint && (
        <span id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </span>
      )}
    </div>
  );
}
