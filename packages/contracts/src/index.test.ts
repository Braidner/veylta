import assert from "node:assert/strict";
import test from "node:test";
import {
  HTTP_API_VERSION,
  LAB_EXTRACTION_SCHEMA_VERSION,
  OBJECT_STORAGE_CONTRACT_VERSION,
} from "./index.js";

test("public contracts carry explicit versions", () => {
  assert.equal(HTTP_API_VERSION, "v1");
  assert.equal(OBJECT_STORAGE_CONTRACT_VERSION, "object-storage/v1");
  assert.equal(LAB_EXTRACTION_SCHEMA_VERSION, "lab-extraction/v1");
});
