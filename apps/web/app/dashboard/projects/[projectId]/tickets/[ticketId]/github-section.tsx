"use client";

import type { EscalationPreview } from "@ai-support-platform/github";
import { useRouter } from "next/navigation";
import { useState } from "react";

type CreateResult =
  | {
      ok: true;
      outcome: { outcome: string; issue?: { number: number; url: string } };
    }
  | { ok: false; error: string };

function isGithubUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}

function AlreadyLinkedIssue({
  number,
  url,
  state,
  repository,
}: {
  number: number | null;
  url: string | null;
  state: string;
  repository: string | null;
}) {
  if (url && isGithubUrl(url) && number !== null) {
    return (
      <p role="status">
        GitHub Issue{" "}
        <a
          className="font-medium text-blue-700 underline"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          #{number}
        </a>
        {" · "}
        {state === "closed" ? "Closed" : "Open"}
        {repository ? ` · ${repository}` : ""}
      </p>
    );
  }
  return <p role="status">Linked issue recorded (pending link details).</p>;
}

export function GitHubSection({
  projectId,
  ticketId,
  initial,
  canPublish,
  issueState,
  repository,
}: {
  projectId: string;
  ticketId: string;
  initial: EscalationPreview;
  /** Publishing to GitHub is owner-only; members see the preview only. */
  canPublish: boolean;
  issueState: string | null;
  repository: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);

  async function create() {
    setPending(true);
    try {
      const fetchImpl = fetch;
      const response = await fetchImpl(
        `/api/dashboard/tickets/${ticketId}/github`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, action: "create" }),
        },
      );
      const payload = (await response.json().catch(() => undefined)) as
        | CreateResult
        | undefined;
      setResult(payload ?? { ok: false, error: "INVALID_RESPONSE" });
      if (payload?.ok) router.refresh();
    } catch {
      setResult({ ok: false, error: "NETWORK_ERROR" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-2 text-sm">
      {initial.state === "not-configured" && (
        <p role="status" className="text-slate-600">
          No GitHub repository is connected to this project yet. Connect one to
          enable escalation.
        </p>
      )}
      {initial.state === "already-linked" && (
        <AlreadyLinkedIssue
          number={initial.issue.number}
          url={initial.issue.url}
          state={issueState ?? "open"}
          repository={repository}
        />
      )}
      {initial.state === "unknown" && (
        <div>
          <p role="alert" className="text-amber-800">
            A previous creation attempt has an unknown outcome. This check only
            looks for an issue created by this GitHub App; it never creates one.
            GitHub's issue list can lag a new issue by a minute, so check again
            shortly if nothing is found, then follow the GitHub recovery
            runbook.
          </p>
          {canPublish && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void create()}
              className="mt-2 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "Checking…" : "Check for existing issue"}
            </button>
          )}
        </div>
      )}
      {initial.state === "in-progress" && (
        <p role="status" className="text-amber-800">
          GitHub issue creation is in progress. Refresh after it finishes. If it
          is still here after a few minutes, the attempt was interrupted: follow
          the GitHub recovery runbook before trying again.
        </p>
      )}
      {initial.state === "blocked" && (
        <div role="status" className="text-slate-600">
          <p>Escalation unavailable: {initial.code}.</p>
          <ul className="mt-1 list-disc pl-5">
            {initial.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {initial.state === "eligible" && (
        <div>
          <p>
            Target repository:{" "}
            <strong>
              {initial.repository.owner}/{initial.repository.repo}
            </strong>
          </p>
          <details className="mt-2 rounded bg-slate-50 p-3">
            <summary className="cursor-pointer font-medium">
              Preview issue content
            </summary>
            <p className="mt-2 font-semibold">{initial.draft.title}</p>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">
              {initial.draft.body}
            </pre>
            <p className="mt-2 text-xs text-slate-500">
              Labels: {initial.candidateLabels.join(", ") || "none"}{" "}
              (intersected with repository labels at creation)
            </p>
          </details>
          {canPublish ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => void create()}
              className="mt-3 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "Creating issue…" : "Create GitHub issue"}
            </button>
          ) : (
            <p role="status" className="mt-3 text-slate-600">
              Only workspace owners can publish issues to GitHub.
            </p>
          )}
        </div>
      )}
      {result && !result.ok && (
        <p role="alert" className="mt-2 text-red-700">
          Action failed: {result.error}
        </p>
      )}
      {result?.ok && result.outcome && (
        <p role="status" className="mt-2 text-emerald-800">
          {result.outcome.outcome === "already-linked"
            ? "Issue already linked."
            : result.outcome.outcome === "reconciled"
              ? `Reconciled with existing issue #${result.outcome.issue?.number}.`
              : result.outcome.outcome === "created"
                ? `Issue created${result.outcome.issue ? ` (#${result.outcome.issue.number})` : ""}.`
                : "Done."}
        </p>
      )}
    </div>
  );
}
