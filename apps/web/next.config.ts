import type { NextConfig } from "next";
import { parseServerEnv } from "./env";

parseServerEnv(process.env);

const nextConfig: NextConfig = {};

export default nextConfig;
