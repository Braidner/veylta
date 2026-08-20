import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_INTELLIGENCE_RESULT_STATUSES,
  DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES,
  DOCUMENT_PAGE_UNREAD_REASONS,
} from "./document-intelligence-results.js";

test("a structured result's type and status come from closed lists", () => {
  assert.deepEqual(DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES, [
    "measurement",
    "genetic_variant",
    "finding",
    "procedure",
    "medication",
    "diagnosis",
    "referral",
    "follow_up",
    "other",
  ]);
  assert.deepEqual(DOCUMENT_INTELLIGENCE_RESULT_STATUSES, [
    "above_range",
    "normal",
    "abnormal",
    "detected",
    "not_detected",
    "completed",
    "informational",
    "unknown",
  ]);
});

test("a page nobody read names a server-derived reason from a closed list", () => {
  assert.deepEqual(DOCUMENT_PAGE_UNREAD_REASONS, ["image_page_limit", "vision_unavailable"]);
});
