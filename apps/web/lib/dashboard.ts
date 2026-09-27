import {
  requireWorkspaceAccess,
  requireWorkspaces,
} from "@ai-support-platform/auth";
import type { TicketRoute } from "@ai-support-platform/db";
import type { TicketFilterQuery } from "./dashboard-filters";
import { getSupportRepository } from "./support-runtime";

/** Human override wins field-by-field; otherwise the AI decision stands. */
export function effectiveEscalation(
  classification: { githubIssueRecommended: boolean } | null,
  override: { githubIssueRecommended: boolean | null } | null,
): boolean | null {
  if (
    override?.githubIssueRecommended !== undefined &&
    override?.githubIssueRecommended !== null
  ) {
    return override.githubIssueRecommended;
  }
  return classification?.githubIssueRecommended ?? null;
}

export function effectiveRoute(
  ticketRoute: TicketRoute | null,
  classification: { route: TicketRoute | null } | null,
): TicketRoute | null {
  return ticketRoute ?? classification?.route ?? null;
}

export interface DashboardTicketRow {
  ticketId: string;
  ticketNumber: number;
  status: string;
  route: string | null;
  categoryHint: string | null;
  createdAt: Date;
  classification: {
    type: string;
    severity: string;
    confidence: number | null;
  } | null;
}

function repository() {
  return getSupportRepository();
}

export async function getDashboardOverview(userId: string) {
  const access = await requireWorkspaces(userId).catch(() => []);
  const repo = repository();
  return Promise.all(
    access.map(async (entry) => {
      const projects = await repo.listProjectsForWorkspace(entry.workspaceId);
      const withCounts = await Promise.all(
        projects.map(async (project) => ({
          project,
          counts: await repo.getTicketStatusCounts(
            entry.workspaceId,
            project.id,
          ),
        })),
      );
      return {
        workspaceId: entry.workspaceId,
        workspaceName: entry.workspaceName,
        role: entry.role,
        projects: withCounts,
      };
    }),
  );
}

export async function getScopedProject(userId: string, projectId: string) {
  const repo = repository();
  const context = await repo.getProjectWorkspace(projectId);
  if (!context) return undefined;
  const access = await requireWorkspaceAccess(
    userId,
    context.workspaceId,
  ).catch(() => undefined);
  if (!access) return undefined;
  const project = await repo.getProjectForWorkspace(
    context.workspaceId,
    projectId,
  );
  if (!project) return undefined;
  return { access, project };
}

const PAGE_SIZE = 20;

export async function getProjectTickets(
  userId: string,
  projectId: string,
  filters: Omit<TicketFilterQuery, "page">,
  page: number,
) {
  const scoped = await getScopedProject(userId, projectId);
  if (!scoped) return undefined;
  const { total, rows } = await repository().listTicketsForDashboard(
    scoped.access.workspaceId,
    projectId,
    {
      ...(filters.statuses.length ? { statuses: filters.statuses } : {}),
      ...(filters.routes.length ? { routes: filters.routes } : {}),
      ...(filters.types.length ? { types: filters.types } : {}),
      ...(filters.severities.length ? { severities: filters.severities } : {}),
      ...(filters.ticketNumber !== undefined
        ? { ticketNumber: filters.ticketNumber }
        : {}),
    },
    { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
  );
  const tickets: DashboardTicketRow[] = rows.map((row) => ({
    ticketId: row.ticket.id,
    ticketNumber: row.ticket.ticketNumber,
    status: row.ticket.status,
    route: row.ticket.route,
    categoryHint: row.ticket.categoryHint,
    createdAt: row.ticket.createdAt,
    classification: row.classification
      ? {
          type: row.classification.type,
          severity: row.classification.severity,
          confidence: row.classification.confidence,
        }
      : null,
  }));
  return {
    access: scoped.access,
    project: scoped.project,
    tickets,
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export async function getTicketDetail(
  userId: string,
  projectId: string,
  ticketId: string,
) {
  const scoped = await getScopedProject(userId, projectId);
  if (!scoped) return undefined;
  const repo = repository();
  const ticket = await repo.getTicketForProject(
    scoped.access.workspaceId,
    projectId,
    ticketId,
  );
  if (!ticket) return undefined;
  const [submission, contact, classification, history, events, override] =
    await Promise.all([
      repo.getTicketSubmissionText(projectId, ticketId),
      repo.getConversationContact(projectId, ticket.conversationId),
      repo.getCurrentClassificationForProject(
        scoped.access.workspaceId,
        projectId,
        ticketId,
      ),
      repo.listClassificationsForTicket(
        scoped.access.workspaceId,
        projectId,
        ticketId,
      ),
      repo.listTicketEvents(projectId, ticketId),
      repo.getLatestOverride(scoped.access.workspaceId, projectId, ticketId),
    ]);
  const [integration, link] = await Promise.all([
    repo.getIntegrationForProject(scoped.access.workspaceId, projectId),
    repo.getGitHubIssueForTicket(
      scoped.access.workspaceId,
      projectId,
      ticketId,
    ),
  ]);
  return {
    access: scoped.access,
    project: scoped.project,
    ticket,
    message: submission?.message ?? null,
    contact: contact ?? null,
    classification,
    history,
    events,
    override,
    integration: integration
      ? {
          repositoryOwner: integration.repositoryOwner,
          repositoryName: integration.repositoryName,
          status: integration.status,
        }
      : null,
    link: link
      ? { status: link.status, issueNumber: link.issueNumber, url: link.url }
      : null,
    effectiveGithubEligible: effectiveEscalation(
      classification
        ? { githubIssueRecommended: classification.githubIssueRecommended }
        : null,
      override?.override
        ? {
            githubIssueRecommended: override.override.githubIssueRecommended,
          }
        : null,
    ),
  };
}
