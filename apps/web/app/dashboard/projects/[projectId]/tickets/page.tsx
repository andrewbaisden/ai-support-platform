import { ticketReference } from "@ai-support-platform/db";
import { notFound } from "next/navigation";
import { getProjectTickets } from "../../../../../lib/dashboard";
import {
  parseTicketFilters,
  ticketFilterSearch,
} from "../../../../../lib/dashboard-filters";
import { requireDashboardUser } from "../../../../../lib/dashboard-session";

export const dynamic = "force-dynamic";

const STATUSES = [
  "needs_triage",
  "queued",
  "escalation_pending",
  "escalated",
  "resolved",
  "quarantined",
] as const;
const ROUTES = ["support", "product", "engineering", "ignore"] as const;
const TYPES = [
  "question",
  "bug",
  "feature_request",
  "account",
  "billing",
  "feedback",
  "spam",
  "other",
] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;

interface PageProps {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TicketListPage({
  params,
  searchParams,
}: PageProps) {
  const { projectId } = await params;
  const { user } = await requireDashboardUser();
  const filters = parseTicketFilters(await searchParams);
  const data = await getProjectTickets(
    user.id,
    projectId,
    filters,
    filters.page,
  );
  if (!data) notFound();
  const { project, tickets, total, page, pageCount } = data;
  return (
    <div>
      <p className="text-sm text-slate-500">
        <a className="underline" href="/dashboard">
          Projects
        </a>{" "}
        / {project.name}
      </p>
      <div className="mt-2 flex flex-wrap items-baseline gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Tickets</h2>
        <p className="text-sm text-slate-600" role="status">
          {total} ticket{total === 1 ? "" : "s"}
        </p>
      </div>

      <form
        method="get"
        className="mt-6 grid gap-3 rounded border border-slate-200 bg-white p-4 md:grid-cols-5"
        aria-label="Filter tickets"
      >
        <label className="text-sm">
          Status
          <select
            name="status"
            defaultValue={filters.statuses}
            multiple
            size={3}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
          >
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Route
          <select
            name="route"
            defaultValue={filters.routes}
            multiple
            size={3}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
          >
            {ROUTES.map((route) => (
              <option key={route} value={route}>
                {route}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Type
          <select
            name="type"
            defaultValue={filters.types}
            multiple
            size={3}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
          >
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Severity
          <select
            name="severity"
            defaultValue={filters.severities}
            multiple
            size={3}
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
          >
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Reference
          <input
            name="q"
            defaultValue={
              filters.ticketNumber !== undefined
                ? `SUP-${filters.ticketNumber}`
                : ""
            }
            placeholder="SUP-123"
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <div className="flex items-end gap-2 md:col-span-5">
          <button
            type="submit"
            className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Apply filters
          </button>
          <a
            href={`/dashboard/projects/${projectId}/tickets`}
            className="rounded border border-slate-300 px-4 py-2 text-sm"
          >
            Clear
          </a>
        </div>
      </form>

      {tickets.length === 0 ? (
        <p
          className="mt-8 rounded border border-slate-200 bg-white p-6 text-slate-600"
          role="status"
        >
          No tickets match these filters.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th scope="col" className="px-4 py-2">
                  Reference
                </th>
                <th scope="col" className="px-4 py-2">
                  Status
                </th>
                <th scope="col" className="px-4 py-2">
                  Route
                </th>
                <th scope="col" className="px-4 py-2">
                  Hint
                </th>
                <th scope="col" className="px-4 py-2">
                  AI type
                </th>
                <th scope="col" className="px-4 py-2">
                  Severity
                </th>
                <th scope="col" className="px-4 py-2">
                  Confidence
                </th>
                <th scope="col" className="px-4 py-2">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.ticketId} className="border-b border-slate-100">
                  <td className="px-4 py-2 font-medium">
                    <a
                      className="text-blue-700 underline"
                      href={`/dashboard/projects/${projectId}/tickets/${ticket.ticketId}`}
                    >
                      {ticketReference(ticket.ticketNumber)}
                    </a>
                  </td>
                  <td className="px-4 py-2">{ticket.status}</td>
                  <td className="px-4 py-2">{ticket.route ?? "—"}</td>
                  <td className="px-4 py-2">{ticket.categoryHint ?? "—"}</td>
                  <td className="px-4 py-2">
                    {ticket.classification?.type ?? "not triaged"}
                  </td>
                  <td className="px-4 py-2">
                    {ticket.classification?.severity ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    {ticket.classification?.confidence !== undefined &&
                    ticket.classification?.confidence !== null
                      ? Number(ticket.classification.confidence).toFixed(2)
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    {ticket.createdAt.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav
        aria-label="Ticket pages"
        className="mt-4 flex items-center gap-3 text-sm"
      >
        <span role="status">
          Page {page} of {pageCount}
        </span>
        {page > 1 && (
          <a
            className="underline"
            href={`/dashboard/projects/${projectId}/tickets${ticketFilterSearch(filters, page - 1)}`}
          >
            Previous
          </a>
        )}
        {page < pageCount && (
          <a
            className="underline"
            href={`/dashboard/projects/${projectId}/tickets${ticketFilterSearch(filters, page + 1)}`}
          >
            Next
          </a>
        )}
      </nav>
    </div>
  );
}
