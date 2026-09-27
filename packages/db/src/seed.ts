import { createHash } from "node:crypto";
import { createDatabase } from "./client";
import { loadRootEnv, requireDatabaseUrl } from "./env";
import {
  conversations,
  messages,
  projects,
  type Severity,
  type TicketRoute,
  type TicketStatus,
  type TicketType,
  ticketClassifications,
  ticketEvents,
  tickets,
  workspaces,
} from "./schema";

loadRootEnv();

const { db, pool } = createDatabase(requireDatabaseUrl("DATABASE_URL"));
const seedTime = new Date("2026-01-01T00:00:00.000Z");
const workspaceId = "10000000-0000-4000-8000-000000000001";
const portfolioProjectId = "20000000-0000-4000-8000-000000000001";
const saasProjectId = "20000000-0000-4000-8000-000000000002";

const examples: Array<{
  id: string;
  projectId: string;
  conversationId: string;
  messageId: string;
  classificationId: string;
  eventId: string;
  text: string;
  type: TicketType;
  severity: Severity;
  route: TicketRoute;
  status: TicketStatus;
  confidence: number;
  githubIssueRecommended: boolean;
  skipClassification?: boolean;
  triageFailed?: boolean;
  secondClassification?: {
    id: string;
    type: TicketType;
    severity: Severity;
    route: TicketRoute;
    confidence: number;
  };
}> = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    projectId: portfolioProjectId,
    conversationId: "40000000-0000-4000-8000-000000000001",
    messageId: "50000000-0000-4000-8000-000000000001",
    classificationId: "60000000-0000-4000-8000-000000000001",
    eventId: "70000000-0000-4000-8000-000000000001",
    text: "What technologies did you use to build this website?",
    type: "question",
    severity: "low",
    route: "support",
    status: "queued",
    confidence: 0.97,
    githubIssueRecommended: false,
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    projectId: portfolioProjectId,
    conversationId: "40000000-0000-4000-8000-000000000002",
    messageId: "50000000-0000-4000-8000-000000000002",
    classificationId: "60000000-0000-4000-8000-000000000002",
    eventId: "70000000-0000-4000-8000-000000000002",
    text: "The projects section becomes blank in Safari after switching to dark mode.",
    type: "bug",
    severity: "medium",
    route: "engineering",
    status: "queued",
    confidence: 0.94,
    githubIssueRecommended: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    projectId: saasProjectId,
    conversationId: "40000000-0000-4000-8000-000000000003",
    messageId: "50000000-0000-4000-8000-000000000003",
    classificationId: "60000000-0000-4000-8000-000000000003",
    eventId: "70000000-0000-4000-8000-000000000003",
    text: "It would be great if the portfolio had a search bar.",
    type: "feature_request",
    severity: "low",
    route: "product",
    status: "queued",
    confidence: 0.91,
    githubIssueRecommended: false,
  },
  {
    id: "30000000-0000-4000-8000-000000000004",
    projectId: saasProjectId,
    conversationId: "40000000-0000-4000-8000-000000000004",
    messageId: "50000000-0000-4000-8000-000000000004",
    classificationId: "60000000-0000-4000-8000-000000000004",
    eventId: "70000000-0000-4000-8000-000000000004",
    text: "Buy cheap cryptocurrency now...",
    type: "spam",
    severity: "low",
    route: "ignore",
    status: "quarantined",
    confidence: 0.99,
    githubIssueRecommended: false,
  },
  {
    id: "30000000-0000-4000-8000-000000000005",
    projectId: portfolioProjectId,
    conversationId: "40000000-0000-4000-8000-000000000005",
    messageId: "50000000-0000-4000-8000-000000000005",
    classificationId: "60000000-0000-4000-8000-000000000005",
    eventId: "70000000-0000-4000-8000-000000000005",
    text: "The page sometimes looks wrong after I resize the window, but I cannot reproduce it reliably.",
    type: "bug",
    severity: "low",
    route: "engineering",
    status: "queued",
    confidence: 0.45,
    githubIssueRecommended: false,
  },
  {
    id: "30000000-0000-4000-8000-000000000006",
    projectId: saasProjectId,
    conversationId: "40000000-0000-4000-8000-000000000006",
    messageId: "50000000-0000-4000-8000-000000000006",
    classificationId: "60000000-0000-4000-8000-000000000006",
    eventId: "70000000-0000-4000-8000-000000000006",
    text: "The contact section is weird.",
    type: "other",
    severity: "low",
    route: "support",
    status: "needs_triage",
    confidence: 0,
    githubIssueRecommended: false,
    skipClassification: true,
    triageFailed: true,
  },
  {
    id: "30000000-0000-4000-8000-000000000007",
    projectId: portfolioProjectId,
    conversationId: "40000000-0000-4000-8000-000000000007",
    messageId: "50000000-0000-4000-8000-000000000007",
    classificationId: "60000000-0000-4000-8000-000000000007",
    eventId: "70000000-0000-4000-8000-000000000007",
    text: "The export button downloads an empty file.",
    type: "bug",
    severity: "medium",
    route: "engineering",
    status: "queued",
    confidence: 0.72,
    githubIssueRecommended: false,
    secondClassification: {
      id: "60000000-0000-4000-8000-000000000017",
      type: "question" as TicketType,
      severity: "low" as Severity,
      route: "support" as TicketRoute,
      confidence: 0.93,
    },
  },
  {
    id: "30000000-0000-4000-8000-000000000008",
    projectId: portfolioProjectId,
    conversationId: "40000000-0000-4000-8000-000000000008",
    messageId: "50000000-0000-4000-8000-000000000008",
    classificationId: "60000000-0000-4000-8000-000000000008",
    eventId: "70000000-0000-4000-8000-000000000008",
    text: "Where can I find the documentation for the widget themes?",
    type: "question",
    severity: "low",
    route: "support",
    status: "resolved",
    confidence: 0.95,
    githubIssueRecommended: false,
  },
];

try {
  await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      name: "Andrew Demo Workspace",
      createdAt: seedTime,
      updatedAt: seedTime,
    })
    .onConflictDoNothing();

  await db
    .insert(projects)
    .values([
      {
        id: portfolioProjectId,
        workspaceId,
        name: "Portfolio Demo",
        slug: "portfolio-demo",
        publicKey: `pk_${"A".repeat(32)}`,
        allowedOrigins: ["http://127.0.0.1:3001"],
        createdAt: seedTime,
        updatedAt: seedTime,
      },
      {
        id: saasProjectId,
        workspaceId,
        name: "Example SaaS",
        slug: "example-saas",
        publicKey: `pk_${"B".repeat(32)}`,
        allowedOrigins: ["http://127.0.0.1:3001"],
        createdAt: seedTime,
        updatedAt: seedTime,
      },
    ])
    .onConflictDoNothing();

  for (const example of examples) {
    await db
      .insert(conversations)
      .values({
        id: example.conversationId,
        projectId: example.projectId,
        createdAt: seedTime,
        updatedAt: seedTime,
      })
      .onConflictDoNothing();
    await db
      .insert(messages)
      .values({
        id: example.messageId,
        projectId: example.projectId,
        conversationId: example.conversationId,
        role: "visitor",
        body: example.text,
        createdAt: seedTime,
      })
      .onConflictDoNothing();
    await db
      .insert(tickets)
      .values({
        id: example.id,
        projectId: example.projectId,
        conversationId: example.conversationId,
        submissionKey: example.id,
        requestFingerprint: createHash("sha256")
          .update(example.text)
          .digest("hex"),
        status: example.status,
        route: example.route,
        createdAt: seedTime,
        updatedAt: seedTime,
      })
      .onConflictDoNothing();
    if (!example.skipClassification) {
      await db
        .insert(ticketClassifications)
        .values({
          id: example.classificationId,
          projectId: example.projectId,
          ticketId: example.id,
          type: example.type,
          severity: example.severity,
          route: example.route,
          githubIssueRecommended: example.githubIssueRecommended,
          confidence: example.confidence,
          source: "fixture",
          createdAt: seedTime,
        })
        .onConflictDoNothing();
    }
    if (example.secondClassification) {
      await db
        .insert(ticketClassifications)
        .values({
          id: example.secondClassification.id,
          projectId: example.projectId,
          ticketId: example.id,
          type: example.secondClassification.type,
          severity: example.secondClassification.severity,
          route: example.secondClassification.route,
          githubIssueRecommended: false,
          confidence: example.secondClassification.confidence,
          source: "fixture",
          createdAt: seedTime,
        })
        .onConflictDoNothing();
    }
    const eventTypes = example.triageFailed
      ? ["submitted", "triage_failed"]
      : example.status === "resolved"
        ? ["submitted", "classified", "resolved"]
        : ["submitted", "classified"];
    for (const [index, eventType] of eventTypes.entries()) {
      await db
        .insert(ticketEvents)
        .values({
          id:
            index === 0
              ? example.eventId
              : `7000000${index}-0000-4000-8000-${example.id.slice(-12)}`,
          projectId: example.projectId,
          ticketId: example.id,
          type: eventType,
          createdAt: seedTime,
        })
        .onConflictDoNothing();
    }
  }
  process.stdout.write(
    "Seeded Andrew Demo Workspace, two projects, and eight sample tickets.\n",
  );
} finally {
  await pool.end();
}
