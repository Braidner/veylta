import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
import { checkedDirectImage } from "./direct-image.js";
import {
  DocumentImageError,
  MAX_DOCUMENT_IMAGE_SOURCE_BYTES,
  MAXIMUM_DOCUMENT_IMAGE_PAGES,
  renderPdfPagesToImages,
} from "./document-images.js";
import { createTextPdf } from "./pdf-test-support.js";

const imagePageFixture = fileURLToPath(
  new URL("../../../../fixtures/veylta-synthetic-image-page-report.pdf", import.meta.url),
);

function isImageLimitExceeded(error: unknown): boolean {
  return error instanceof DocumentImageError && error.code === "IMAGE_LIMIT_EXCEEDED";
}

function isInvalidDocument(error: unknown): boolean {
  return error instanceof DocumentImageError && error.code === "INVALID_DOCUMENT";
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

test("renders exactly the requested pages under their own page numbers", async () => {
  const bytes = new Uint8Array(readFileSync(imagePageFixture));

  const images = await renderPdfPagesToImages(bytes, { pages: [2] });

  assert.deepEqual(
    images.map((image) => ({ pageNumber: image.pageNumber, contentType: image.contentType })),
    [{ pageNumber: 2, contentType: "image/png" }],
  );
  assert.ok((images[0]?.bytes.byteLength ?? 0) > 0);
});

test("more requested pages than one run may carry renders the first in page order", async () => {
  const bytes = createTextPdf([["one"], ["two"], ["three"], ["four"], ["five"]]);

  const images = await renderPdfPagesToImages(bytes, { pages: [5, 4, 3, 2] });

  assert.deepEqual(
    images.map((image) => image.pageNumber),
    [2, 3, 4].slice(0, MAXIMUM_DOCUMENT_IMAGE_PAGES),
  );
});

test("a document longer than the page cap still renders a page the caller names", async () => {
  const bytes = createTextPdf([["one"], ["two"], ["three"], ["four"]]);

  const images = await renderPdfPagesToImages(bytes, { pages: [4, 4] });

  assert.deepEqual(
    images.map((image) => image.pageNumber),
    [4],
  );
  await assert.rejects(() => renderPdfPagesToImages(bytes), isImageLimitExceeded);
});

test("a requested page the document does not have is refused", async () => {
  const bytes = createTextPdf([["one"], ["two"]]);

  await assert.rejects(() => renderPdfPagesToImages(bytes, { pages: [3] }), isInvalidDocument);
  await assert.rejects(() => renderPdfPagesToImages(bytes, { pages: [0] }), isInvalidDocument);
});
