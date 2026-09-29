"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SettingsResult =
  | { ok: true; allowedOrigins?: string[]; repository?: string }
  | { ok: false; error: string; installUrl?: string };

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_ORIGINS:
    "Each address must be a site origin such as https://my-site.vercel.app or http://localhost:3000, with no path.",
  INVALID_REQUEST: "Enter the repository as owner/name.",
  OWNER_REQUIRED: "Only workspace owners can change settings.",
  ALREADY_CONNECTED: "This project is already connected to a repository.",
  APP_NOT_INSTALLED:
    "The GitHub App is not installed on that repository yet. Install it, then try again.",
  GITHUB_NOT_CONFIGURED:
    "GitHub is not configured on this deployment. Add the GitHub App variables and redeploy.",
  GITHUB_UNAVAILABLE: "GitHub could not be reached. Try again shortly.",
  UNAUTHENTICATED: "Your session has expired. Sign in again.",
  NETWORK_ERROR: "The request did not reach the server. Try again.",
};

function message(error: string) {
  return ERROR_MESSAGES[error] ?? "Something went wrong. Try again.";
}

async function postSettings(
  projectId: string,
  body: object,
): Promise<SettingsResult> {
  try {
    const fetchImpl = fetch;
    const response = await fetchImpl(
      `/api/dashboard/projects/${projectId}/settings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const payload = (await response.json().catch(() => undefined)) as
      | SettingsResult
      | undefined;
    return payload ?? { ok: false, error: "INVALID_RESPONSE" };
  } catch {
    return { ok: false, error: "NETWORK_ERROR" };
  }
}

/** Owner-only editor that replaces the project's allowed origins. */
export function OriginsEditor({
  projectId,
  initial,
}: {
  projectId: string;
  initial: string[];
}) {
  const router = useRouter();
  const [origins, setOrigins] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<SettingsResult | null>(null);

  async function save(next: string[]) {
    setPending(true);
    const result = await postSettings(projectId, {
      action: "origins",
      allowedOrigins: next,
    });
    setStatus(result);
    if (result.ok) {
      setOrigins(result.allowedOrigins ?? next);
      setDraft("");
      router.refresh();
    }
    setPending(false);
  }

  return (
    <div className="grid gap-3 text-sm">
      {origins.length === 0 ? (
        <p className="text-amber-800">
          No addresses yet: the widget cannot send reports until you add one.
        </p>
      ) : (
        <ul aria-label="Allowed origins" className="grid gap-2">
          {origins.map((origin) => (
            <li
              key={origin}
              className="flex items-center justify-between rounded bg-slate-50 px-3 py-2"
            >
              <code>{origin}</code>
              <button
                type="button"
                disabled={pending}
                aria-label={`Remove ${origin}`}
                onClick={() => save(origins.filter((o) => o !== origin))}
                className="text-red-700 underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft.trim().replace(/\/$/, "");
          if (value) void save([...origins, value]);
        }}
      >
        <label className="grid flex-1 gap-1">
          Add site address
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="https://my-site.vercel.app"
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>
      {status &&
        (status.ok ? (
          <p role="status" className="text-emerald-800">
            Saved.
          </p>
        ) : (
          <p role="alert" className="text-red-700">
            {message(status.error)}
          </p>
        ))}
    </div>
  );
}

/** Owner-only form to connect a repository the GitHub App is installed on. */
export function ConnectRepositoryForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<SettingsResult | null>(null);

  return (
    <form
      className="grid gap-3 text-sm"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        const result = await postSettings(projectId, {
          action: "connect",
          repository: value.trim().replace(/^https:\/\/github\.com\//, ""),
        });
        setStatus(result);
        setPending(false);
        if (result.ok) router.refresh();
      }}
    >
      <p className="text-slate-600">
        Confirmed bug reports can become issues in this repository. Install the
        GitHub App on it first.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid flex-1 gap-1">
          Repository (owner/name)
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="your-name/your-site"
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="rounded bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          Connect
        </button>
      </div>
      {status && !status.ok && (
        <p role="alert" className="text-red-700">
          {message(status.error)}
          {status.installUrl && (
            <>
              {" "}
              <a
                className="font-medium text-blue-700 underline"
                href={status.installUrl}
                target="_blank"
                rel="noreferrer"
              >
                Install the GitHub App
              </a>
            </>
          )}
        </p>
      )}
    </form>
  );
}
