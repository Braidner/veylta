import { MAX_SYNTHETIC_DOCUMENT_UPLOAD_BYTES } from "@veylta/contracts";
import type { NextConfig } from "next";
import { trustedDevHostnames } from "./next-config-helpers.js";

const apiInternalUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4301";
const configuredWebOrigins = process.env.WEB_ORIGINS ?? process.env.WEB_ORIGIN;

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: trustedDevHostnames(configuredWebOrigins),
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  experimental: {
    // The browser reaches the API only through the rewrite below, and the router clones a
    // proxied request body before forwarding it. Next caps that clone at 10 MB by default and
    // then forwards a truncated body without failing the request, so a larger document died
    // upstream as a broken multipart part. The cap must admit a whole upload.
    proxyClientMaxBodySize: MAX_SYNTHETIC_DOCUMENT_UPLOAD_BYTES,
  },
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
