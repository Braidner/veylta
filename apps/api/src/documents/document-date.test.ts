import assert from "node:assert/strict";
import test from "node:test";
import { effectiveDocumentDate, isCalendarDate } from "./document-date.js";

test("the effective date: the person's correction, then the document's own date, then the upload day in UTC", () => {
  const uploadedAt = "2026-08-19T23:40:00.000Z";
  assert.deepEqual(
    effectiveDocumentDate({ override: "2026-05-14", documentDate: "2026-08-12", uploadedAt }),
    { value: "2026-05-14", source: "person" },
  );
  assert.deepEqual(
    effectiveDocumentDate({ override: null, documentDate: "2026-08-12", uploadedAt }),
    {
      value: "2026-08-12",
      source: "document",
    },
  );
  assert.deepEqual(effectiveDocumentDate({ override: null, documentDate: null, uploadedAt }), {
    value: "2026-08-19",
    source: "upload",
  });
});

test("a calendar date is ten characters that round-trip through the calendar", () => {
  assert.equal(isCalendarDate("2026-02-28"), true);
  assert.equal(isCalendarDate("2026-02-30"), false);
  assert.equal(isCalendarDate("2026-8-1"), false);
  assert.equal(isCalendarDate("2026-08-12T00:00:00.000Z"), false);
  assert.equal(isCalendarDate("yesterday"), false);
});
