import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_API_REQUEST_DURATION_MS,
  MAX_SYNTHETIC_DOCUMENT_UPLOAD_BYTES,
} from "@veylta/contracts";
import nextConfig from "./next.config.js";

test("the rewrite to the API admits a whole document upload", () => {
  // The browser never reaches the API directly, so this cap bounds every upload. Below one
  // whole upload Next forwards a truncated body instead of failing the request, and the
  // document dies upstream as a broken multipart part rather than as a size the person can act on.
  assert.equal(
    nextConfig.experimental?.proxyClientMaxBodySize,
    MAX_SYNTHETIC_DOCUMENT_UPLOAD_BYTES,
  );
});

test("the rewrite to the API never gives up before the API itself would", () => {
  // Next's proxy abandons an upstream request after 30 s by default. An assistant turn spends
  // two Codex budgets and runs past that, so the API persisted a verified answer while the
  // browser was told the connection had failed. The proxy must outlast every request the API
  // is allowed to take, not decide the deadline itself.
  assert.equal(nextConfig.experimental?.proxyTimeout, MAX_API_REQUEST_DURATION_MS);
});

test("the API is reachable only through the /health-api rewrite", async () => {
  const rewrites = await nextConfig.rewrites?.();
  assert.ok(Array.isArray(rewrites));
  assert.deepEqual(
    rewrites.map(({ source }) => source),
    ["/health-api/:path*"],
  );
});
