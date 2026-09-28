import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./client";
import { loadRootEnv, requireSafeTestDatabaseUrl } from "./env";
import { createSupportRepository } from "./repository";
import { users } from "./schema";

loadRootEnv();
const { db, pool } = createDatabase(requireSafeTestDatabaseUrl());
const support = createSupportRepository(db);

beforeAll(async () => {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE ticket_overrides, workspace_members, "user", "session", "account", verification, webhook_events, github_issues, github_integrations, ticket_events, ticket_classifications, tickets, messages, conversations, projects, workspaces, submission_rate_limits RESTART IDENTITY CASCADE`,
  );
});
afterAll(async () => {
  await pool.end();
});

async function createUser(email = `owner-${randomUUID()}@example.test`) {
  const [user] = await db
    .insert(users)
    .values({ id: randomUUID(), name: "Owner", email })
    .returning();
  if (!user) throw new Error("User insert failed");
  return user;
}

const site = {
  name: "My site",
  slug: "my-site",
  allowedOrigins: ["https://site.example.test"],
};

describe("self-hosting bootstrap", () => {
  it("counts accounts so a fresh installation can be detected", async () => {
    expect(await support.countUsers()).toBe(0);
    await createUser();
    expect(await support.countUsers()).toBe(1);
  });

  it("creates one owner workspace and project, then reuses them", async () => {
    const owner = await createUser();
    const first = await support.bootstrapWorkspaceProject({
      userId: owner.id,
      workspaceName: "IssueRelay",
      project: site,
    });
    expect(first).toMatchObject({
      createdWorkspace: true,
      createdProject: true,
    });
    expect(first.project.publicKey).toMatch(/^pk_[A-Za-z0-9_-]{32}$/);
    expect(first.project.allowedOrigins).toEqual(["https://site.example.test"]);
    const again = await support.bootstrapWorkspaceProject({
      userId: owner.id,
      workspaceName: "IssueRelay",
      project: site,
    });
    expect(again).toMatchObject({
      createdWorkspace: false,
      createdProject: false,
      workspace: { id: first.workspace.id },
      project: { id: first.project.id, publicKey: first.project.publicKey },
    });
    const second = await support.bootstrapWorkspaceProject({
      userId: owner.id,
      workspaceName: "IssueRelay",
      project: { ...site, name: "Blog", slug: "blog" },
    });
    expect(second).toMatchObject({
      createdWorkspace: false,
      createdProject: true,
    });
    const memberships = await support.listWorkspacesForUser(owner.id);
    expect(memberships.map((row) => row.role)).toEqual(["owner"]);
    const counts = await db.execute(
      sql`SELECT (SELECT count(*)::int FROM projects) AS projects, (SELECT count(*)::int FROM tickets) AS tickets, (SELECT count(*)::int FROM github_integrations) AS integrations`,
    );
    expect(counts.rows[0]).toEqual({
      projects: 2,
      tickets: 0,
      integrations: 0,
    });
  });

  it("rolls back the whole bootstrap when the project is invalid", async () => {
    const owner = await createUser();
    await expect(
      support.bootstrapWorkspaceProject({
        userId: owner.id,
        workspaceName: "IssueRelay",
        project: {
          ...site,
          allowedOrigins: ["https://site.example.test/path"],
        },
      }),
    ).rejects.toThrow();
    expect(await support.listWorkspacesForUser(owner.id)).toEqual([]);
  });

  it("updates allowed origins only inside the owning workspace", async () => {
    const owner = await createUser();
    const other = await createUser();
    const mine = await support.bootstrapWorkspaceProject({
      userId: owner.id,
      workspaceName: "Mine",
      project: site,
    });
    const theirs = await support.bootstrapWorkspaceProject({
      userId: other.id,
      workspaceName: "Theirs",
      project: site,
    });
    const updated = await support.updateProjectAllowedOrigins(
      mine.workspace.id,
      mine.project.id,
      [
        "https://site.example.test",
        "https://www.site.example.test",
        "https://site.example.test",
      ],
    );
    expect(updated.allowedOrigins).toEqual([
      "https://site.example.test",
      "https://www.site.example.test",
    ]);
    await expect(
      support.updateProjectAllowedOrigins(
        mine.workspace.id,
        theirs.project.id,
        ["https://evil.example.test"],
      ),
    ).rejects.toThrow("Project not found in workspace");
    await expect(
      support.updateProjectAllowedOrigins(mine.workspace.id, mine.project.id, [
        "not-an-origin",
      ]),
    ).rejects.toThrow();
    expect(
      (
        await support.getProjectForWorkspace(
          theirs.workspace.id,
          theirs.project.id,
        )
      )?.allowedOrigins,
    ).toEqual(["https://site.example.test"]);
  });
});
