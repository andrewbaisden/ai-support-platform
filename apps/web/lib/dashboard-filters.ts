import type {
  Severity,
  TicketRoute,
  TicketStatus,
  TicketType,
} from "@ai-support-platform/db";
import { z } from "zod";

const statusValues = [
  "needs_triage",
  "queued",
  "escalation_pending",
  "escalated",
  "resolved",
  "quarantined",
] as const;
const routeValues = ["support", "product", "engineering", "ignore"] as const;
const typeValues = [
  "question",
  "bug",
  "feature_request",
  "account",
  "billing",
  "feedback",
  "spam",
  "other",
] as const;
const severityValues = ["low", "medium", "high", "critical"] as const;

function toList(
  value: string | string[] | undefined,
  allowed: readonly string[],
): string[] {
  const values = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  return values.filter((entry) => allowed.includes(entry));
}

/** Parse a ticket reference or bare number into a ticket number. */
export function parseTicketReference(
  value: string | string[] | undefined,
): number | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) return undefined;
  const reference = /^SUP-(\d+)$/i.exec(text.trim());
  const digits = /^\d+$/.exec(text.trim());
  const number = reference?.[1] ?? digits?.[0];
  return number === undefined ? undefined : Number(number);
}

export interface TicketFilterQuery {
  statuses: TicketStatus[];
  routes: TicketRoute[];
  types: TicketType[];
  severities: Severity[];
  ticketNumber?: number;
  page: number;
}

export function ticketFilterSchema() {
  return z.object({
    statuses: z.array(z.enum(statusValues)),
    routes: z.array(z.enum(routeValues)),
    types: z.array(z.enum(typeValues)),
    severities: z.array(z.enum(severityValues)),
    ticketNumber: z.number().int().positive().optional(),
    page: z.number().int().min(1),
  });
}

/**
 * Parse URL search params into validated ticket-list filters. Unknown values
 * are dropped, never trusted; page defaults to 1.
 */
export function parseTicketFilters(
  searchParams: Record<string, string | string[] | undefined>,
): TicketFilterQuery {
  const rawPage = Array.isArray(searchParams.page)
    ? searchParams.page[0]
    : searchParams.page;
  const page = Number(rawPage);
  return ticketFilterSchema().parse({
    statuses: toList(searchParams.status, statusValues),
    routes: toList(searchParams.route, routeValues),
    types: toList(searchParams.type, typeValues),
    severities: toList(searchParams.severity, severityValues),
    ticketNumber: parseTicketReference(searchParams.q),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  });
}

/** Serialize filters back into a query string for pagination links. */
export function ticketFilterSearch(
  filters: Omit<TicketFilterQuery, "page" | "ticketNumber"> & {
    ticketNumber?: number;
  },
  page: number,
): string {
  const params = new URLSearchParams();
  for (const status of filters.statuses) params.append("status", status);
  for (const route of filters.routes) params.append("route", route);
  for (const type of filters.types) params.append("type", type);
  for (const severity of filters.severities)
    params.append("severity", severity);
  if (filters.ticketNumber !== undefined) {
    params.set("q", `SUP-${filters.ticketNumber}`);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `?${query}` : "";
}
