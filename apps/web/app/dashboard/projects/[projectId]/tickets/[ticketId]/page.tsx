import { LOW_CONFIDENCE_REVIEW_FLOOR } from "@ai-support-platform/ai";
import { ticketReference } from "@ai-support-platform/db";
import { previewEscalation } from "@ai-support-platform/github";
import { notFound } from "next/navigation";
import { getTicketDetail } from "../../../../../../lib/dashboard";
import { requireDashboardUser } from "../../../../../../lib/dashboard-session";
import { usesMockEscalation } from "../../../../../../lib/github-tracker";
import { GitHubSection } from "./github-section";
import {
  OverrideForm,
  ResolveReopenButtons,
  RetriageButton,
} from "./ticket-actions";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ projectId: string; ticketId: string }>;
}

function Confidence({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <span>Not classified yet</span>;
  }
  const belowFloor = value < LOW_CONFIDENCE_REVIEW_FLOOR;
  return (
    <span>
      <strong>{Number(value).toFixed(2)}</strong>{" "}
      {belowFloor && (
        <span className="ml-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
          Needs review
        </span>
      )}
      <span className="block text-xs font-normal text-slate-500">
        Spread-based model score, not a calibrated probability of correctness.
      </span>
    </span>
  );
}

export default async function TicketDetailPage({ params }: PageProps) {
  const { projectId, ticketId } = await params;
  const { user } = await requireDashboardUser();
  const detail = await getTicketDetail(user.id, projectId, ticketId);
  if (!detail) notFound();
  const {
    access,
    project,
    ticket,
    message,
    contact,
    classification,
    history,
    events,
    override,
    effectiveGithubEligible,
    integration,
    link,
  } = detail;
  const githubPreview = previewEscalation({
    ticket: {
      ticketId: ticket.id,
      ticketReference: ticketReference(ticket.ticketNumber),
      status: ticket.status,
      route: ticket.route,
      reportedAt: ticket.createdAt,
      message: message ?? "",
      categoryHint: ticket.categoryHint,
      contact: contact
        ? { name: contact.visitorName, email: contact.visitorEmail }
        : null,
      classification: classification
        ? {
            type: classification.type,
            severity: classification.severity,
            confidence: classification.confidence,
            route: classification.route,
            githubIssueRecommended: classification.githubIssueRecommended,
            source: classification.source,
          }
        : null,
      override: detail.effectiveOverride
        ? {
            route: detail.effectiveOverride.route,
            githubIssueRecommended:
              detail.effectiveOverride.githubIssueRecommended,
          }
        : null,
    },
    integration: integration ?? undefined,
    link: link ?? undefined,
    allowFixtureClassifications: usesMockEscalation(),
  });
  return (
    <div>
      <p className="text-sm text-slate-500">
        <a className="underline" href="/dashboard">
          Projects
        </a>{" "}
        /{" "}
        <a
          className="underline"
          href={`/dashboard/projects/${project.id}/tickets`}
        >
          {project.name}
        </a>{" "}
        / {ticketReference(ticket.ticketNumber)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">
          {ticketReference(ticket.ticketNumber)}
        </h2>
        <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold">
          {ticket.status}
        </span>
        {ticket.route && (
          <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold">
            {ticket.route}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Created {ticket.createdAt.toLocaleString()}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="visitor-report"
          className="rounded border border-slate-200 bg-white p-5"
        >
          <h3 id="visitor-report" className="font-semibold">
            Visitor report
          </h3>
          {message === null ? (
            <p className="mt-2 text-sm text-slate-600" role="status">
              Original message unavailable.
            </p>
          ) : (
            <blockquote className="mt-2 border-l-4 border-slate-200 pl-3 text-sm">
              {message}
            </blockquote>
          )}
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-slate-500">Hint:</dt>
              <dd>{ticket.categoryHint ?? "none"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-slate-500">Name:</dt>
              <dd>{contact?.visitorName || "not provided"}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-slate-500">Email:</dt>
              <dd>{contact?.visitorEmail || "not provided"}</dd>
            </div>
          </dl>
        </section>

        <section
          aria-labelledby="classification"
          className="rounded border border-slate-200 bg-white p-5"
        >
          <h3 id="classification" className="font-semibold">
            Current AI classification
          </h3>
          {classification === undefined || classification === null ? (
            <p className="mt-2 text-sm text-slate-600" role="status">
              No classification yet. The ticket is awaiting triage or triage
              failed.
            </p>
          ) : (
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-slate-500">Type:</dt>
                <dd>{classification.type}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-500">Severity:</dt>
                <dd>{classification.severity}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-500">Route:</dt>
                <dd>{classification.route ?? "unset"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-500">Confidence:</dt>
                <dd>
                  <Confidence value={classification.confidence} />
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-500">Provider:</dt>
                <dd>
                  {classification.provider ?? "unknown"}
                  {classification.model ? ` (${classification.model})` : ""}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-500">GitHub escalation:</dt>
                <dd>
                  {effectiveGithubEligible === null
                    ? "no recommendation"
                    : effectiveGithubEligible
                      ? "Recommended (no issue created yet)"
                      : "Not recommended"}
                </dd>
              </div>
              {classification.reason && (
                <div className="flex gap-2">
                  <dt className="text-slate-500">Note:</dt>
                  <dd>{classification.reason}</dd>
                </div>
              )}
            </dl>
          )}
        </section>

        {override && (
          <section
            aria-labelledby="override"
            className="rounded border border-amber-300 bg-amber-50 p-5"
          >
            <h3 id="override" className="font-semibold">
              Human review decision
            </h3>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-slate-500">Decided by:</dt>
                <dd>{override.authorEmail}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-slate-500">At:</dt>
                <dd>{override.override.createdAt.toLocaleString()}</dd>
              </div>
              {override.override.route && (
                <div className="flex gap-2">
                  <dt className="text-slate-500">Route:</dt>
                  <dd>{override.override.route}</dd>
                </div>
              )}
              {override.override.status && (
                <div className="flex gap-2">
                  <dt className="text-slate-500">Status:</dt>
                  <dd>{override.override.status}</dd>
                </div>
              )}
              {override.override.githubIssueRecommended !== null && (
                <div className="flex gap-2">
                  <dt className="text-slate-500">GitHub:</dt>
                  <dd>
                    {override.override.githubIssueRecommended
                      ? "recommended"
                      : "declined"}
                  </dd>
                </div>
              )}
              <div className="flex gap-2">
                <dt className="text-slate-500">Reason:</dt>
                <dd>{override.override.reason}</dd>
              </div>
            </dl>
          </section>
        )}

        <section
          aria-labelledby="history"
          className="rounded border border-slate-200 bg-white p-5"
        >
          <h3 id="history" className="font-semibold">
            Classification history
          </h3>
          {history.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600" role="status">
              No attempts recorded.
            </p>
          ) : (
            <ol className="mt-2 space-y-2 text-sm">
              {history.map((entry, index) => (
                <li key={entry.id} className="rounded bg-slate-50 px-3 py-2">
                  <p>
                    {index === 0 && (
                      <strong className="mr-2 rounded bg-slate-900 px-1.5 py-0.5 text-xs text-white">
                        current
                      </strong>
                    )}
                    {entry.type} · {entry.severity} · {entry.route ?? "unset"} ·{" "}
                    {entry.confidence !== null
                      ? Number(entry.confidence).toFixed(2)
                      : "no score"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {entry.source}
                    {entry.provider ? `/${entry.provider}` : ""}
                    {entry.model ? ` ${entry.model}` : ""} ·{" "}
                    {entry.createdAt.toLocaleString()}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          aria-labelledby="timeline"
          className="rounded border border-slate-200 bg-white p-5"
        >
          <h3 id="timeline" className="font-semibold">
            Timeline
          </h3>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600" role="status">
              No events recorded.
            </p>
          ) : (
            <ol className="mt-2 space-y-2 text-sm">
              {events.map((event) => (
                <li key={event.id}>
                  <span className="font-medium">{event.type}</span>{" "}
                  <span className="text-slate-500">
                    {event.createdAt.toLocaleString()}
                  </span>
                  {event.summary && (
                    <span className="block text-slate-600">
                      {event.summary}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section
          aria-labelledby="github"
          className="rounded border border-slate-200 bg-white p-5 lg:col-span-2"
        >
          <h3 id="github" className="font-semibold">
            GitHub escalation
          </h3>
          <GitHubSection
            projectId={project.id}
            ticketId={ticket.id}
            initial={githubPreview}
            canPublish={access.role === "owner"}
            issueState={link?.status ?? null}
            repository={
              integration
                ? `${integration.repositoryOwner}/${integration.repositoryName}`
                : null
            }
          />
        </section>

        <section
          aria-labelledby="actions"
          className="rounded border border-slate-200 bg-white p-5 lg:col-span-2"
        >
          <h3 id="actions" className="font-semibold">
            Operator actions
          </h3>
          <div className="mt-3 grid gap-6 md:grid-cols-3">
            <div>
              <h4 className="text-sm font-semibold">Triage</h4>
              <div className="mt-2">
                <RetriageButton projectId={project.id} ticketId={ticket.id} />
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold">Workflow</h4>
              <div className="mt-2">
                <ResolveReopenButtons
                  projectId={project.id}
                  ticketId={ticket.id}
                  status={ticket.status}
                />
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold">Review decision</h4>
              <div className="mt-2">
                {access.role === "owner" ? (
                  <OverrideForm
                    projectId={project.id}
                    ticketId={ticket.id}
                    currentRoute={ticket.route}
                  />
                ) : (
                  <p role="status" className="text-sm text-slate-600">
                    Only workspace owners can record review decisions.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
