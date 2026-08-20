import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
import {
  checkedDirectImage,
  DocumentImageError,
  MAX_DOCUMENT_IMAGE_SOURCE_BYTES,
  renderPdfPagesToImages,
} from "./document-images.js";

function isImageLimitExceeded(error: unknown): boolean {
  return error instanceof DocumentImageError && error.code === "IMAGE_LIMIT_EXCEEDED";
}

test("the rasterisation bound sits strictly under the household storage ceiling", () => {
  assert.ok(MAX_DOCUMENT_IMAGE_SOURCE_BYTES < MAX_SYNTHETIC_DOCUMENT_BYTES);
});

test("a PDF between the image bound and the storage ceiling is refused for rasterisation only", async () => {
  const oversized = Buffer.alloc(MAX_DOCUMENT_IMAGE_SOURCE_BYTES + 1);
  oversized.write("%PDF-", 0, "ascii");
  assert.ok(oversized.byteLength <= MAX_SYNTHETIC_DOCUMENT_BYTES, "still a legal upload size");
  await assert.rejects(() => renderPdfPagesToImages(oversized), isImageLimitExceeded);
});

test("a direct PNG between the image bound and the storage ceiling is refused for rasterisation only", async () => {
  const oversized = Buffer.alloc(MAX_DOCUMENT_IMAGE_SOURCE_BYTES + 1);
  oversized.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  assert.ok(oversized.byteLength <= MAX_SYNTHETIC_DOCUMENT_BYTES, "still a legal upload size");
  await assert.rejects(() => checkedDirectImage(oversized, "image/png"), isImageLimitExceeded);
});
