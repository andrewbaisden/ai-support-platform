import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appEnvFile,
  buildAppManifest,
  convertManifestCode,
} from "../app-manifest";

/**
 * Create this deployment's GitHub App from a manifest: correct permissions
 * and the Issues webhook are preset. Credentials go to a git-ignored file,
 * never to the terminal.
 */
function usage(): never {
  process.stdout.write(
    `Usage: pnpm github:create-app --platform https://<your-issuerelay-url> [--org <github-org>] [--name "<App name>"] [--no-browser] [--force]

Opens GitHub in your browser to create a private GitHub App with
Issues (read/write) and Metadata (read) permissions and the Issues webhook
pointed at <platform>/api/webhooks/github. The App ID, private key, and
webhook secret are written to .env.github-app.local (git-ignored).
`,
  );
  process.exit(2);
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const platform = argValue("--platform");
if (!platform || process.argv.includes("--help")) usage();
try {
  if (new URL(platform).protocol !== "https:") throw new Error();
} catch {
  process.stderr.write("--platform must be your deployment's https:// URL.\n");
  process.exit(2);
}
const org = argValue("--org");
if (org && !/^[A-Za-z0-9-]{1,39}$/.test(org)) usage();
const outputFile = join(
  fileURLToPath(new URL("../../../..", import.meta.url)),
  ".env.github-app.local",
);
if (existsSync(outputFile) && !process.argv.includes("--force")) {
  process.stderr.write(
    `${outputFile} already exists. Move it away or pass --force.\n`,
  );
  process.exit(2);
}

const state = randomBytes(16).toString("hex");
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("No port");
const base = `http://127.0.0.1:${address.port}`;
const manifest = buildAppManifest({
  platformUrl: platform,
  redirectUrl: `${base}/callback`,
  ...(argValue("--name") ? { name: argValue("--name") } : {}),
});
const githubForm = org
  ? `https://github.com/organizations/${org}/settings/apps/new?state=${state}`
  : `https://github.com/settings/apps/new?state=${state}`;

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const page = (body: string) =>
  `<!doctype html><meta charset="utf-8"><title>IssueRelay GitHub App</title><body style="font-family:system-ui;max-width:40rem;margin:4rem auto">${body}</body>`;

const done = new Promise<void>((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Timed out waiting for GitHub (10 minutes).")),
    10 * 60 * 1000,
  );
  server.on("request", (request, response) => {
    const url = new URL(request.url ?? "/", base);
    if (url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        page(`<p>Sending the IssueRelay App manifest to GitHub…</p>
<form id="f" method="post" action="${escapeHtml(githubForm)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<button type="submit">Continue to GitHub</button></form>
<script>document.getElementById("f").submit()</script>`),
      );
      return;
    }
    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code") ?? "";
      if (url.searchParams.get("state") !== state) {
        response.writeHead(400, { "Content-Type": "text/html" });
        response.end(page("<p>State mismatch. Start again.</p>"));
        return;
      }
      convertManifestCode(code)
        .then((app) => {
          writeFileSync(outputFile, appEnvFile(app), { mode: 0o600 });
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end(
            page(
              `<h1>GitHub App created</h1><p>Return to your terminal for the next steps. You can close this tab.</p>`,
            ),
          );
          process.stdout.write(
            [
              "",
              `Created GitHub App "${app.slug}": ${app.html_url}`,
              `Credentials written to ${outputFile} (git-ignored; delete it after copying).`,
              "",
              "Next steps:",
              "  1. Add GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_WEBHOOK_SECRET from that file",
              "     to your Vercel project's Production environment variables, then redeploy.",
              `  2. Install the App on your repository: https://github.com/apps/${app.slug}/installations/new`,
              "  3. In the IssueRelay dashboard, open your project's Settings and connect the repository.",
              "",
            ].join("\n"),
          );
          clearTimeout(timer);
          resolve();
        })
        .catch((error: unknown) => {
          response.writeHead(502, { "Content-Type": "text/html" });
          response.end(
            page("<p>Could not finish creating the App. See the terminal.</p>"),
          );
          clearTimeout(timer);
          reject(error);
        });
      return;
    }
    response.writeHead(404);
    response.end();
  });
});

process.stdout.write(
  `Opening your browser to create the GitHub App for ${manifest.url}.\nIf it does not open, visit ${base}/\n`,
);
const opener =
  process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "explorer"
      : "xdg-open";
if (!process.argv.includes("--no-browser")) {
  spawn(opener, [`${base}/`], { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

try {
  await done;
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "GitHub App creation failed."}\n`,
  );
  process.exitCode = 1;
} finally {
  server.close();
}
