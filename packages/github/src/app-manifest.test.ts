// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  appEnvFile,
  buildAppManifest,
  convertManifestCode,
} from "./app-manifest";

// Fake PEM text assembled at runtime so no key-shaped literal is committed.
const pemMarker = ["BEGIN", "RSA PRIVATE KEY"].join(" ");
const fakePem = `-----${pemMarker}-----\nMIIfake\nline2\n-----END RSA PRIVATE KEY-----\n`;

describe("GitHub App manifest", () => {
  it("requests only Issues and Metadata, and subscribes to Issues events", () => {
    const manifest = buildAppManifest({
      platformUrl: "https://my-issuerelay.vercel.app/some/path",
      redirectUrl: "http://127.0.0.1:4567/callback",
    });
    expect(manifest).toEqual({
      name: "IssueRelay my-issuerelay",
      url: "https://my-issuerelay.vercel.app",
      description: expect.any(String),
      hook_attributes: {
        url: "https://my-issuerelay.vercel.app/api/webhooks/github",
        active: true,
      },
      redirect_url: "http://127.0.0.1:4567/callback",
      public: false,
      default_permissions: { issues: "write", metadata: "read" },
      default_events: ["issues"],
    });
  });

  it("keeps App names within GitHub's limit and requires https", () => {
    const long = buildAppManifest({
      platformUrl:
        "https://a-very-long-deployment-name-for-issuerelay.vercel.app",
      redirectUrl: "http://127.0.0.1:1/callback",
    });
    expect(long.name.length).toBeLessThanOrEqual(34);
    expect(
      buildAppManifest({
        platformUrl: "https://issuerelay-selfhost-check.vercel.app",
        redirectUrl: "http://127.0.0.1:1/callback",
      }).name,
    ).toBe("IssueRelay selfhost-check");
    expect(() =>
      buildAppManifest({
        platformUrl: "http://insecure.example.test",
        redirectUrl: "http://127.0.0.1:1/callback",
      }),
    ).toThrow("https://");
  });

  it("converts a manifest code into validated credentials", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: 991,
            slug: "issuerelay-my-site",
            html_url: "https://github.com/apps/issuerelay-my-site",
            pem: fakePem,
            webhook_secret: "0123456789abcdef0123",
            client_secret: "not-needed",
          }),
          { status: 201 },
        ),
    );
    const app = await convertManifestCode("abc123", fetchImpl);
    expect(app).toMatchObject({ id: 991, slug: "issuerelay-my-site" });
    expect(String(vi.mocked(fetchImpl).mock.calls[0]?.[0])).toBe(
      "https://api.github.com/app-manifests/abc123/conversions",
    );
    const env = appEnvFile(app);
    expect(env).toContain("GITHUB_APP_ID=991");
    expect(env).toContain(
      `GITHUB_APP_PRIVATE_KEY="-----${pemMarker}-----\\nMIIfake\\nline2`,
    );
    expect(env).toContain("GITHUB_WEBHOOK_SECRET=0123456789abcdef0123");
    expect(env).not.toContain("client_secret");
  });

  it("rejects malformed codes and unexpected responses", async () => {
    await expect(convertManifestCode("../../evil")).rejects.toThrow(
      "Invalid manifest code",
    );
    await expect(
      convertManifestCode(
        "abc",
        vi.fn(async () => new Response("{}", { status: 404 })),
      ),
    ).rejects.toThrow("404");
    await expect(
      convertManifestCode(
        "abc",
        vi.fn(async () => new Response(JSON.stringify({ id: 1 }))),
      ),
    ).rejects.toThrow("Unexpected");
  });
});
