// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  BootstrapError,
  type BootstrapPorts,
  bootstrapInstallation,
  slugify,
} from "./bootstrap";

function fakePorts(existing?: { id: string }) {
  let user = existing;
  const ports: BootstrapPorts = {
    findUserByEmail: vi.fn(async () => user),
    createOwner: vi.fn(async () => {
      user = { id: "user-1" };
    }),
    markUserEmailVerified: vi.fn(async () => {}),
    bootstrapWorkspaceProject: vi.fn(async (input) => ({
      workspace: { id: "ws-1" },
      project: {
        id: "project-1",
        name: input.project.name,
        publicKey: "pk_public",
        allowedOrigins: input.project.allowedOrigins,
      },
      createdWorkspace: true,
      createdProject: true,
    })),
  };
  return ports;
}

const input = {
  ownerEmail: "owner@example.test",
  ownerName: "Owner",
  ownerPassword: "a-long-owner-password",
  workspaceName: "IssueRelay",
  projectName: "My Portfolio Site!",
  allowedOrigins: ["https://site.example.test"],
};

describe("bootstrapInstallation", () => {
  it("creates a verified owner, workspace, and slugged project", async () => {
    const ports = fakePorts();
    const result = await bootstrapInstallation(ports, input);
    expect(ports.createOwner).toHaveBeenCalledWith({
      email: "owner@example.test",
      password: "a-long-owner-password",
      name: "Owner",
    });
    expect(ports.markUserEmailVerified).toHaveBeenCalledWith("user-1");
    expect(ports.bootstrapWorkspaceProject).toHaveBeenCalledWith({
      userId: "user-1",
      workspaceName: "IssueRelay",
      project: {
        name: "My Portfolio Site!",
        slug: "my-portfolio-site",
        allowedOrigins: ["https://site.example.test"],
      },
    });
    expect(result).toMatchObject({
      createdOwner: true,
      projectId: "project-1",
      publicKey: "pk_public",
    });
  });

  it("reuses an existing owner without a password and never changes it", async () => {
    const ports = fakePorts({ id: "user-9" });
    const result = await bootstrapInstallation(ports, {
      ...input,
      ownerPassword: undefined,
    });
    expect(ports.createOwner).not.toHaveBeenCalled();
    expect(result.createdOwner).toBe(false);
  });

  it("requires a strong password only to create a new owner", async () => {
    for (const ownerPassword of [undefined, "short-password"]) {
      await expect(
        bootstrapInstallation(fakePorts(), { ...input, ownerPassword }),
      ).rejects.toMatchObject({ code: "PASSWORD_REQUIRED" });
    }
  });

  it("rejects invalid details before touching storage", async () => {
    const ports = fakePorts();
    await expect(
      bootstrapInstallation(ports, { ...input, ownerEmail: "not-an-email" }),
    ).rejects.toBeInstanceOf(BootstrapError);
    await expect(
      bootstrapInstallation(ports, { ...input, allowedOrigins: [] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(ports.findUserByEmail).not.toHaveBeenCalled();
  });

  it("slugifies display names safely", () => {
    expect(slugify("  Héllo, World!  ")).toBe("hello-world");
    expect(slugify("***")).toBe("project");
    expect(slugify("a".repeat(120)).length).toBe(80);
  });
});
