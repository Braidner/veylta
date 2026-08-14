import type { NextConfig } from "next";

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4301";

const nextConfig: NextConfig = {
  agentRules: false,
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
