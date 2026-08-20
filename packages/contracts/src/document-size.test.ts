import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_SYNTHETIC_DOCUMENT_BYTES,
  MAX_SYNTHETIC_DOCUMENT_UPLOAD_BYTES,
  MAX_SYNTHETIC_PDF_BYTES,
  SYNTHETIC_DOCUMENT_MULTIPART_OVERHEAD_BYTES,
} from "./document-size.js";

test("one local source may be a hundred megabytes, whatever its type", () => {
  assert.equal(MAX_SYNTHETIC_DOCUMENT_BYTES, 100 * 1024 * 1024);
  assert.equal(MAX_SYNTHETIC_PDF_BYTES, MAX_SYNTHETIC_DOCUMENT_BYTES);
});

test("the upload bound leaves room for the multipart framing around the source", () => {
  assert.equal(SYNTHETIC_DOCUMENT_MULTIPART_OVERHEAD_BYTES, 128 * 1024);
  assert.equal(
    MAX_SYNTHETIC_DOCUMENT_UPLOAD_BYTES,
    MAX_SYNTHETIC_DOCUMENT_BYTES + SYNTHETIC_DOCUMENT_MULTIPART_OVERHEAD_BYTES,
  );
  // A hop that admits exactly one document and not its envelope truncates every upload.
  assert.ok(MAX_SYNTHETIC_DOCUMENT_UPLOAD_BYTES > MAX_SYNTHETIC_DOCUMENT_BYTES);
});
