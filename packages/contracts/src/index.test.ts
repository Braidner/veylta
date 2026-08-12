import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_CONTRACT_VERSION,
  FAMILY_PROFILE_CONTRACT_VERSION,
  HTTP_API_VERSION,
  LAB_EXTRACTION_SCHEMA_VERSION,
  MAX_SYNTHETIC_PDF_BYTES,
  OBJECT_STORAGE_CONTRACT_VERSION,
} from "./index.js";

test("public contracts carry explicit versions", () => {
  assert.equal(HTTP_API_VERSION, "v1");
  assert.equal(DOCUMENT_CONTRACT_VERSION, "document/v1");
  assert.equal(FAMILY_PROFILE_CONTRACT_VERSION, "family-profile/v1");
  assert.equal(OBJECT_STORAGE_CONTRACT_VERSION, "object-storage/v1");
  assert.equal(LAB_EXTRACTION_SCHEMA_VERSION, "lab-extraction/v1");
  assert.equal(MAX_SYNTHETIC_PDF_BYTES, 5 * 1024 * 1024);
});
