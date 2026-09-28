// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAppInstallUrl, lookupRepositoryInstallation } from "./app-auth";
import { GithubError } from "./errors";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const options = { appId: "123", privateKey };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Minimal GitHub API: routes by method and path. */
function stubGitHub(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const key = `${init?.method ?? "GET"} ${url.pathname}`;
      calls.push(key);
      const route = routes[key];
      return route ? route() : json({ message: "Not Found" }, 404);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupRepositoryInstallation", () => {
  it("returns the installation and canonical repository identity", async () => {
    const calls = stubGitHub({
      "GET /repos/Owner/Site/installation": () => json({ id: 77 }),
      "POST /app/installations/77/access_tokens": () =>
        json(
          { token: "ghs_installation", expires_at: "2099-01-01T00:00:00Z" },
          201,
        ),
      "GET /repos/Owner/Site": () =>
        json({ id: 4242, name: "site", owner: { login: "owner" } }),
    });
    expect(
      await lookupRepositoryInstallation(options, {
        owner: "Owner",
        repo: "Site",
      }),
    ).toEqual({
      installationId: "77",
      repositoryId: "4242",
      owner: "owner",
      repo: "site",
    });
    expect(calls).toEqual([
      "GET /repos/Owner/Site/installation",
      "POST /app/installations/77/access_tokens",
      "GET /repos/Owner/Site",
    ]);
  });

  it("returns undefined when the App is not installed on the repository", async () => {
    stubGitHub({});
    expect(
      await lookupRepositoryInstallation(options, { owner: "o", repo: "r" }),
    ).toBeUndefined();
  });

  it("maps GitHub outages to safe errors and requires credentials", async () => {
    stubGitHub({
      "GET /repos/o/r/installation": () => json({ message: "boom" }, 503),
    });
    await expect(
      lookupRepositoryInstallation(options, { owner: "o", repo: "r" }),
    ).rejects.toBeInstanceOf(GithubError);
    await expect(
      lookupRepositoryInstallation(
        { appId: "", privateKey: "" },
        { owner: "o", repo: "r" },
      ),
    ).rejects.toMatchObject({ code: "GITHUB_MISCONFIGURED" });
  });
});

describe("fetchAppInstallUrl", () => {
  it("links to the App's install page, or nothing when GitHub fails", async () => {
    stubGitHub({ "GET /app": () => json({ slug: "issuerelay-my-site" }) });
    expect(await fetchAppInstallUrl(options)).toBe(
      "https://github.com/apps/issuerelay-my-site/installations/new",
    );
    stubGitHub({});
    expect(await fetchAppInstallUrl(options)).toBeUndefined();
  });
});
