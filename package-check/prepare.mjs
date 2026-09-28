// Pack @issuerelay/widget exactly as npm would publish it, verify the
// tarball, and install it into consumers outside the workspace. Playwright
// (package-check/playwright.config.ts) then exercises the built consumers.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const WORK = join(tmpdir(), "issuerelay-package-check");
const TARBALL = join(WORK, "issuerelay-widget.tgz");

const run = (command, args, cwd = ROOT) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });
const output = (command, args, cwd = ROOT) =>
  execFileSync(command, args, { cwd, encoding: "utf8" });
function fail(message) {
  console.error(`package-check: ${message}`);
  process.exit(1);
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// 1. Build and pack exactly what `npm publish` would upload.
run("pnpm", ["--filter", "@ai-support-platform/support-contracts", "build"]);
run("pnpm", ["--filter", "@issuerelay/widget", "build"]);
run(
  "pnpm",
  ["pack", "--pack-destination", WORK],
  join(ROOT, "packages/widget"),
);
const packed = readdirSync(WORK).find((name) => name.endsWith(".tgz"));
if (!packed) fail("pnpm pack produced no tarball");
renameSync(join(WORK, packed), TARBALL);

// 2. The tarball contains only the public build and its documents.
const files = output("tar", ["-tzf", TARBALL]).trim().split("\n").sort();
const expected = [
  "package/LICENSE",
  "package/README.md",
  "package/dist/index.d.ts",
  "package/dist/index.js",
  "package/package.json",
];
if (JSON.stringify(files) !== JSON.stringify(expected)) {
  fail(`unexpected tarball contents:\n${files.join("\n")}`);
}

// 3. The published manifest is public, complete, and workspace-free.
const manifestText = output("tar", ["-xzOf", TARBALL, "package/package.json"]);
const manifest = JSON.parse(manifestText);
const problems = [];
if (manifest.name !== "@issuerelay/widget") problems.push("name");
if (manifest.license !== "MIT") problems.push("license");
if (manifest.private) problems.push("private flag");
if (manifestText.includes("workspace:")) problems.push("workspace protocol");
if (manifest.devDependencies)
  problems.push("devDependencies in published manifest");
if (!manifest.peerDependencies?.react) problems.push("react peer");
for (const dependency of Object.keys(manifest.dependencies ?? {})) {
  if (dependency.startsWith("@ai-support-platform/")) {
    problems.push(`private dependency ${dependency}`);
  }
}
if (problems.length > 0) fail(`manifest problems: ${problems.join(", ")}`);

// 4. Shipped code is browser-only: allowed imports, no server or secrets.
const js = output("tar", ["-xzOf", TARBALL, "package/dist/index.js"]);
const dts = output("tar", ["-xzOf", TARBALL, "package/dist/index.d.ts"]);
if (!js.startsWith('"use client";'))
  fail('dist/index.js must start with "use client"');
const allowedImports = new Set([
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react-hook-form",
]);
const imports = [...`${js}\n${dts}`.matchAll(/from\s+["']([^"']+)["']/g)].map(
  (match) => match[1],
);
const unexpected = [...new Set(imports)].filter(
  (name) => !allowedImports.has(name),
);
if (unexpected.length > 0) fail(`unexpected imports: ${unexpected.join(", ")}`);
const forbidden = [
  // Strict-CSP hosts report any eval attempt, even a caught probe.
  /new Function\(|\beval\(/,
  /process\.env/,
  /\bnode:/,
  /DATABASE_URL|BETTER_AUTH|GITHUB_APP|GITHUB_WEBHOOK|TYPESAFE_API_KEY/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(drizzle|octokit|better-auth|pg-pool|@typesafe-ai)\b/,
  /@ai-support-platform\/(db|ai|auth|github)/,
];
for (const pattern of forbidden) {
  if (pattern.test(js) || pattern.test(dts))
    fail(`forbidden content ${pattern}`);
}

// 5. Install the tarball into consumers outside the workspace and build them.
for (const consumer of ["vite", "next"]) {
  const target = join(WORK, consumer);
  cpSync(join(ROOT, "package-check/consumers", consumer), target, {
    recursive: true,
  });
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--loglevel=error"],
    target,
  );
  run("npm", ["run", "build"], target);
}

// 6. The consumer's browser bundle carries no server code or secrets either.
const assets = join(WORK, "vite/dist/assets");
for (const file of readdirSync(assets).filter((name) => name.endsWith(".js"))) {
  const bundle = readFileSync(join(assets, file), "utf8");
  for (const pattern of forbidden.slice(3)) {
    if (pattern.test(bundle))
      fail(`consumer bundle ${file} contains ${pattern}`);
  }
}

console.log(
  `package-check: ${manifest.name}@${manifest.version} packed (${files.length} files) and built in ${WORK}`,
);
