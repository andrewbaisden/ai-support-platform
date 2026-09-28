import type { NextConfig } from "next";
import { parseServerEnv } from "./env";
import { securityHeaders } from "./lib/security-headers";

parseServerEnv(process.env);

// NEXT_DIST_DIR gives the browser suite its own dev output and lock, so it
// can run beside a regular `pnpm dev` of the same app.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders(process.env.NODE_ENV) },
    ];
  },
};

export default nextConfig;
