import { defineConfig } from "tsup";

/**
 * One self-contained ESM entry for npm. The shared contract constants are
 * bundled in (they are not published separately, and carry no Zod); React
 * and react-hook-form stay external so consumers dedupe them. esbuild drops module
 * directives while bundling, so `"use client"` is restored as a banner for
 * React Server Components hosts such as the Next.js App Router.
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "browser",
  target: "es2022",
  clean: true,
  sourcemap: false,
  noExternal: ["@ai-support-platform/support-contracts"],
  external: ["react", "react-dom", "react-hook-form"],
  // Point the declaration build at the contracts source so its types are
  // inlined like local code instead of referencing the private package.
  dts: {
    compilerOptions: {
      rootDir: "..",
      paths: {
        "@ai-support-platform/support-contracts/constants": [
          "../support-contracts/src/constants.ts",
        ],
      },
    },
  },
});
