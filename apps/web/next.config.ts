import type { NextConfig } from "next";
import { parseServerEnv } from "./env";

parseServerEnv(process.env);

// NEXT_DIST_DIR gives the browser suite its own dev output and lock, so it
// can run beside a regular `pnpm dev` of the same app.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
