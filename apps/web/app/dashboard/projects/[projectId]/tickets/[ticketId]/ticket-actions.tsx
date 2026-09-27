"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type ActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function postMutation(
  ticketId: string,
  action: "retriage" | "status" | "override",
  body: Record<string, unknown>,
): Promise<ActionResult> {
  let response: Response;
  try {
    // Bare call on purpose: native fetch throws "Illegal invocation" when
    // called as a method on a non-global receiver.
    const fetchImpl = fetch;
    response = await fetchImpl(`/api/dashboard/tickets/${ticketId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "NETWORK_ERROR" };
  }
  const payload = (await response.json().catch(() => undefined)) as
    | ActionResult
    | undefined;
  if (!payload || typeof payload.ok !== "boolean") {
    return { ok: false, error: "INVALID_RESPONSE" };
  }
  return payload;
}

function ResultMessage({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <p
      role={result.ok ? "status" : "alert"}
      className={`mt-2 text-sm ${result.ok ? "text-emerald-800" : "text-red-700"}`}
    >
      {result.ok ? result.message : `Action failed: ${result.error}`}
    </p>
  );
}

export function RetriageButton({
  projectId,
  ticketId,
}: {
  projectId: string;
  ticketId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void postMutation(ticketId, "retriage", { projectId }).then(
            (outcome) => {
              setResult(outcome);
              setPending(false);
              if (outcome.ok) router.refresh();
            },
          );
        }}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Running triage…" : "Re-run AI triage"}
      </button>
      <ResultMessage result={result} />
    </div>
  );
}

export function ResolveReopenButtons({
  projectId,
  ticketId,
  status,
}: {
  projectId: string;
  ticketId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const target = status === "resolved" ? "queued" : "resolved";
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const outcome = await postMutation(ticketId, "status", {
              projectId,
              to: target,
            });
            setResult(outcome);
            if (outcome.ok) router.refresh();
          })
        }
        className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {pending
          ? "Working…"
          : status === "resolved"
            ? "Reopen ticket"
            : "Mark resolved"}
      </button>
      <ResultMessage result={result} />
    </div>
  );
}

export function OverrideForm({
  projectId,
  ticketId,
  currentRoute,
}: {
  projectId: string;
  ticketId: string;
  currentRoute: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [route, setRoute] = useState("");
  const [status, setStatus] = useState("");
  const [github, setGithub] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      aria-label="Record a human review decision"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const outcome = await postMutation(ticketId, "override", {
            projectId,
            ...(route ? { route } : {}),
            ...(status ? { status } : {}),
            ...(github === "recommend"
              ? { githubIssueRecommended: true }
              : github === "decline"
                ? { githubIssueRecommended: false }
                : {}),
            reason,
          });
          setResult(outcome);
          if (outcome.ok) router.refresh();
        });
      }}
      className="grid gap-3"
    >
      <p className="text-sm text-slate-600">
        Current route: {currentRoute ?? "unset"}. Decisions are stored
        separately with your authorship; AI history is never rewritten.
      </p>
      <label className="text-sm">
        Route
        <select
          value={route}
          onChange={(event) => setRoute(event.target.value)}
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
        >
          <option value="">No change</option>
          <option value="support">support</option>
          <option value="product">product</option>
          <option value="engineering">engineering</option>
          <option value="ignore">ignore</option>
        </select>
      </label>
      <label className="text-sm">
        Status
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
        >
          <option value="">No change</option>
          <option value="queued">Move to queued (releases quarantine)</option>
        </select>
      </label>
      <fieldset className="text-sm">
        <legend>GitHub escalation recommendation</legend>
        <label className="mr-4">
          <input
            type="radio"
            name="github"
            checked={github === ""}
            onChange={() => setGithub("")}
          />{" "}
          No change
        </label>
        <label className="mr-4">
          <input
            type="radio"
            name="github"
            checked={github === "recommend"}
            onChange={() => setGithub("recommend")}
          />{" "}
          Recommend
        </label>
        <label>
          <input
            type="radio"
            name="github"
            checked={github === "decline"}
            onChange={() => setGithub("decline")}
          />{" "}
          Decline
        </label>
      </fieldset>
      <label className="text-sm">
        Reason (required)
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          maxLength={500}
          rows={2}
          className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Recording…" : "Record decision"}
      </button>
      <ResultMessage result={result} />
    </form>
  );
}
