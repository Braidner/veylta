import {
  MAX_API_REQUEST_DURATION_MS,
  MAX_SYNTHETIC_DOCUMENT_UPLOAD_BYTES,
} from "@veylta/contracts";
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
    // The same rewrite abandons an upstream request after 30 s by default and answers the
    // browser with a socket hang-up. An assistant turn spends two Codex budgets and runs past
    // that, so the API persisted a verified answer while the person was told to check their
    // connection. Only the API may decide a request has run too long; this admits the longest
    // one it allows. It does not cover a консилиум — see MAX_API_REQUEST_DURATION_MS.
    proxyTimeout: MAX_API_REQUEST_DURATION_MS,
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
