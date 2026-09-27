import { getDashboardOverview } from "../../lib/dashboard";
import { requireDashboardUser } from "../../lib/dashboard-session";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  needs_triage: "Needs triage",
  queued: "Queued",
  escalation_pending: "Escalation pending",
  escalated: "Escalated",
  resolved: "Resolved",
  quarantined: "Quarantined",
};

export default async function DashboardPage() {
  const { user } = await requireDashboardUser();
  const overview = await getDashboardOverview(user.id);
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Projects</h2>
      <p className="mt-2 max-w-2xl text-slate-600">
        Ticket volume by workflow state. Open a project to filter, inspect,
        re-triage, or resolve tickets.
      </p>
      {overview.length === 0 && (
        <p
          className="mt-8 rounded border border-slate-200 bg-white p-6 text-slate-600"
          role="status"
        >
          No workspaces are available to this account yet.
        </p>
      )}
      {overview.map((entry) => (
        <section
          key={entry.workspaceId}
          aria-label={entry.workspaceName}
          className="mt-8"
        >
          <h3 className="text-lg font-semibold">{entry.workspaceName}</h3>
          {entry.projects.length === 0 && (
            <p className="mt-2 text-slate-600" role="status">
              No projects in this workspace yet.
            </p>
          )}
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {entry.projects.map(({ project, counts }) => {
              const total = counts.reduce((sum, row) => sum + row.count, 0);
              return (
                <li
                  key={project.id}
                  className="rounded border border-slate-200 bg-white p-5"
                >
                  <div className="flex items-baseline justify-between">
                    <h4 className="font-semibold">{project.name}</h4>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        project.status === "active"
                          ? "bg-emerald-100 text-emerald-900"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {project.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {total} ticket{total === 1 ? "" : "s"} · key{" "}
                    <code>{project.publicKey.slice(0, 6)}…</code>
                  </p>
                  <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    {counts.map((row) => (
                      <div
                        key={row.status}
                        className="rounded bg-slate-50 px-2 py-1"
                      >
                        <dt className="text-slate-500">
                          {STATUS_LABELS[row.status] ?? row.status}
                        </dt>
                        <dd className="font-semibold">{row.count}</dd>
                      </div>
                    ))}
                  </dl>
                  <a
                    className="mt-4 inline-block font-medium text-blue-700 underline"
                    href={`/dashboard/projects/${project.id}/tickets`}
                  >
                    Open tickets
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
