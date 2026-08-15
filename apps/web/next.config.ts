import type { NextConfig } from "next";
import { trustedDevHostnames } from "./next-config-helpers.js";

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4301";
const configuredWebOrigins = process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN;

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: trustedDevHostnames(configuredWebOrigins),
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/health-api/:path*",
        destination: `${apiInternalUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
