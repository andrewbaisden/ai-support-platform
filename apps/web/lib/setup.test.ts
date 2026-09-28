// @vitest-environment node
import { BootstrapError } from "@ai-support-platform/auth";
import { describe, expect, it, vi } from "vitest";
import { handleSetupPost, type SetupDependencies, tokensMatch } from "./setup";

const TOKEN = "k4R9vQ2mX7pL1zN8sT5wY3bC6dF0gH2jK4mP";
const body = {
  token: TOKEN,
  ownerName: "Owner",
  ownerEmail: "owner@example.test",
  ownerPassword: "a-long-owner-password",
  workspaceName: "IssueRelay",
  projectName: "My site",
  allowedOrigins: ["https://site.example.test"],
};

function deps(overrides: Partial<SetupDependencies> = {}) {
  return {
    setupToken: TOKEN,
    countUsers: vi.fn(async () => 0),
    bootstrap: vi.fn(async () => ({
      createdOwner: true,
      createdWorkspace: true,
      createdProject: true,
      workspaceId: "ws",
      projectId: "p",
      projectName: "My site",
      publicKey: "pk_public_key",
      allowedOrigins: ["https://site.example.test"],
    })),
    ...overrides,
  } satisfies SetupDependencies;
}

function post(payload: unknown, origin = "https://app.example.test") {
  return new Request("https://app.example.test/api/setup", {
    method: "POST",
    headers: {
      host: "app.example.test",
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(payload),
  });
}

describe("first-run setup", () => {
  it("creates the owner and first project and returns the widget key", async () => {
    const d = deps();
    const response = await handleSetupPost(post(body), d);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      projectName: "My site",
      publicKey: "pk_public_key",
      allowedOrigins: ["https://site.example.test"],
    });
    const [input] = vi.mocked(d.bootstrap).mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(input).not.toHaveProperty("token");
    expect(input).toMatchObject({ ownerEmail: "owner@example.test" });
  });

  it("is closed once any account exists or without a configured token", async () => {
    for (const d of [
      deps({ countUsers: vi.fn(async () => 1) }),
      deps({ setupToken: undefined }),
      deps({ setupToken: "" }),
    ]) {
      const response = await handleSetupPost(post(body), d);
      expect(response.status).toBe(404);
      expect(d.bootstrap).not.toHaveBeenCalled();
    }
  });

  it("requires a same-origin request, valid details, and the right token", async () => {
    const d = deps();
    expect((await handleSetupPost(post(body, ""), d)).status).toBe(403);
    expect(
      (await handleSetupPost(post(body, "https://evil.example.test"), d))
        .status,
    ).toBe(403);
    expect(
      (await handleSetupPost(post({ ...body, ownerPassword: "short" }), d))
        .status,
    ).toBe(400);
    expect(
      (await handleSetupPost(post({ ...body, extra: true }), d)).status,
    ).toBe(400);
    const wrong = await handleSetupPost(post({ ...body, token: "nope" }), d);
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({
      ok: false,
      error: "INVALID_SETUP_TOKEN",
    });
    expect(d.bootstrap).not.toHaveBeenCalled();
  });

  it("reports bootstrap problems without internal detail", async () => {
    const invalid = deps({
      bootstrap: vi.fn(async () => {
        throw new BootstrapError("INVALID_INPUT", "Setup details are invalid.");
      }),
    });
    const bad = await handleSetupPost(post(body), invalid);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "INVALID_INPUT" });

    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = deps({
      bootstrap: vi.fn(async () => {
        throw new Error("connection refused at db.internal:5432");
      }),
    });
    const failed = await handleSetupPost(post(body), broken);
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("db.internal");
  });

  it("compares tokens in constant time regardless of length", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
    expect(tokensMatch("short", TOKEN)).toBe(false);
    expect(tokensMatch(`${TOKEN}x`, TOKEN)).toBe(false);
  });
});
