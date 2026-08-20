import assert from "node:assert/strict";
import test from "node:test";
import { formatSampleDay, formatSampleMoment, formatShortMoment } from "./format-moment.js";

test("a source date without a time is shown as a date, never as midnight in some time zone", () => {
  assert.equal(formatSampleMoment("2026-08-10T00:00:00.000Z"), "10 августа 2026 г.");
  assert.equal(formatSampleMoment("2026-08-10"), "10 августа 2026 г.");
});

test("a real time of day keeps its hours and minutes in the reader's zone", () => {
  const copy = formatSampleMoment("2026-08-10T12:30:00.000Z");
  assert.match(copy, /^10 августа 2026 г\. в \d{2}:\d{2}$/);
});

test("anything that is not a canonical moment is left verbatim", () => {
  assert.equal(formatSampleMoment("весна 2026"), "весна 2026");
  assert.equal(formatSampleMoment(""), "");
});

test("a list row gets the short form: day, month, clock time", () => {
  assert.match(formatShortMoment("2026-08-17T16:45:00.000Z"), /^17 авг\., \d{2}:\d{2}$/);
});

test("a tight line gets the day alone, and a date-only value keeps its printed day", () => {
  assert.equal(formatSampleDay("2026-05-14"), "14 мая");
  assert.equal(formatSampleDay("2026-05-14T00:00:00.000Z"), "14 мая");
  assert.match(formatSampleDay("2026-05-14T12:30:00.000Z"), /^1[45] мая$/);
  assert.equal(formatSampleDay("весна 2026"), "весна 2026");
});
