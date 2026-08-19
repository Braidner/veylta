import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_TIMELINE_CONTRACT_VERSION,
  isInDocumentQueue,
  latestCorrectableDate,
  MAX_DOCUMENT_TIMELINE_DAYS,
} from "./document-timeline.js";

test("a document is in the queue until its processing completed and every fact is decided", () => {
  assert.equal(isInDocumentQueue({ state: "not_started" }, 0), true);
  assert.equal(
    isInDocumentQueue({ state: "queued", updatedAt: "2026-08-10T08:00:00.000Z" }, 0),
    true,
  );
  assert.equal(
    isInDocumentQueue({ state: "text_extraction", updatedAt: "2026-08-10T08:00:00.000Z" }, 0),
    true,
  );
  assert.equal(
    isInDocumentQueue(
      {
        state: "failed",
        updatedAt: "2026-08-10T08:00:00.000Z",
        category: "extraction_failed",
        retryAllowed: true,
      },
      0,
    ),
    true,
  );
  assert.equal(
    isInDocumentQueue(
      {
        state: "awaiting_review",
        updatedAt: "2026-08-10T08:00:00.000Z",
        factCount: 2,
        needsReviewCount: 1,
      },
      2,
    ),
    true,
  );
  assert.equal(
    isInDocumentQueue(
      { state: "completed", updatedAt: "2026-08-10T08:00:00.000Z", factCount: 2 },
      1,
    ),
    true,
    "a completed run with an undecided fact is still the person's turn",
  );
  assert.equal(
    isInDocumentQueue(
      { state: "completed", updatedAt: "2026-08-10T08:00:00.000Z", factCount: 2 },
      0,
    ),
    false,
  );
});

test("the latest correctable date is tomorrow in UTC", () => {
  assert.equal(latestCorrectableDate(new Date("2026-08-19T23:30:00.000Z")), "2026-08-20");
  assert.equal(latestCorrectableDate(new Date("2026-12-31T00:00:00.000Z")), "2027-01-01");
  assert.equal(MAX_DOCUMENT_TIMELINE_DAYS, 50);
  assert.equal(DOCUMENT_TIMELINE_CONTRACT_VERSION, "document-timeline/v1");
});
