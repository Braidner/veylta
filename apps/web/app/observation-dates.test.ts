import assert from "node:assert/strict";
import test from "node:test";
import { observation } from "./dossier.fixture";
import { knownObservationDates, observationSourceHref, timelineDate } from "./observation-dates";

test("the timeline date prefers the sample, then the result, then the upload — with its label", () => {
  const item = observation({ id: "d1" });
  assert.equal(timelineDate(item).label, "Дата биоматериала");

  // The fixture's `dates.resultedAt` is always null (no override for it), so the "result" branch
  // needs its own non-null value here rather than the brief's plain `{ ...dates, sampledAt: null }`
  // — with resultedAt still null too, the code would fall through past it to "Дата загрузки".
  const resultOnly = {
    ...item,
    dates: { ...item.dates, sampledAt: null, resultedAt: "2026-08-11T08:00:00.000Z" },
  };
  assert.equal(timelineDate(resultOnly).label, "Дата результата");

  const uploadOnly = {
    ...item,
    dates: { sampledAt: null, resultedAt: null, uploadedAt: item.dates.uploadedAt },
  };
  assert.equal(timelineDate(uploadOnly).label, "Дата загрузки");

  // Known dates are the non-null ones: the default fixture only ever sets sample + upload, so the
  // "all three known" case is exercised through `resultOnly` (sample dropped, result gained) too.
  assert.equal(knownObservationDates(item).length, 2);
  assert.equal(knownObservationDates(resultOnly).length, 2);
  assert.equal(knownObservationDates(uploadOnly).length, 1);
});

test("the source href is the API-prefixed content path", () => {
  const item = observation({ id: "d1" });
  assert.equal(observationSourceHref(item.sourceDocument.contentPath), "/health-api/v1/x");
});
