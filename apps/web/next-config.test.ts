import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SYNTHETIC_DOCUMENT_UPLOAD_BYTES } from "@veylta/contracts";
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

test("the API is reachable only through the /health-api rewrite", async () => {
  const rewrites = await nextConfig.rewrites?.();
  assert.ok(Array.isArray(rewrites));
  assert.deepEqual(
    rewrites.map(({ source }) => source),
    ["/health-api/:path*"],
  );
});
