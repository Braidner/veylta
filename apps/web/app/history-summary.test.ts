import assert from "node:assert/strict";
import test from "node:test";
import { buildDossierSeries } from "./dossier";
import { observation } from "./dossier.fixture";
import {
  defaultPeriodFor,
  defaultSelectionKey,
  historyPeriodLabel,
  historySummary,
  periodStart,
} from "./history-summary";

const now = new Date("2026-08-20T12:00:00.000Z");

test("period starts are UTC month arithmetic; «всё» has no bound", () => {
  assert.equal(periodStart("3m", now), "2026-05-20T12:00:00.000Z");
  assert.equal(periodStart("6m", now), "2026-02-20T12:00:00.000Z");
  assert.equal(periodStart("12m", now), "2025-08-20T12:00:00.000Z");
  assert.equal(periodStart("all", now), null);
  assert.equal(historyPeriodLabel["12m"], "Год");
});

test("a period's day is clamped to a shorter target month, never rolled into the next one", () => {
  const endOfAugust = new Date("2026-08-31T12:00:00.000Z");
  assert.equal(periodStart("6m", endOfAugust), "2026-02-28T12:00:00.000Z");
  assert.equal(periodStart("3m", endOfAugust), "2026-05-31T12:00:00.000Z");
  // A leap February takes the 29th.
  assert.equal(periodStart("6m", new Date("2024-08-31T12:00:00.000Z")), "2024-02-29T12:00:00.000Z");
});

test("the page opens on the narrowest period that still holds the latest value", () => {
  const seriesAt = (at: string) =>
    buildDossierSeries([observation({ id: "d", at })], null)[0] ?? null;
  assert.equal(defaultPeriodFor(seriesAt("2026-06-20T12:00:00.000Z"), now), "3m", "two months old");
  assert.equal(defaultPeriodFor(seriesAt("2025-12-20T12:00:00.000Z"), now), "12m", "eight months");
  assert.equal(defaultPeriodFor(seriesAt("2024-08-20T12:00:00.000Z"), now), "all", "two years");
  assert.equal(defaultPeriodFor(null, now), "all", "nothing measured");
});

test("the four buckets: moved out, returned, unchanged, first measured — by the dossier's status rule", () => {
  const series = buildDossierSeries(
    [
      // tsh: within long ago, above now → moved outside (baseline = the point before the period).
      observation({ id: "t1", code: "tsh", value: "2,0", at: "2025-01-10T08:00:00.000Z" }),
      observation({ id: "t2", code: "tsh", value: "9,9", at: "2026-08-10T08:00:00.000Z" }),
      // ferritin: above long ago, within now → returned inside.
      observation({
        id: "f1",
        code: "ferritin",
        name: "Ферритин",
        value: "9,0",
        at: "2025-01-10T08:00:00.000Z",
      }),
      observation({
        id: "f2",
        code: "ferritin",
        name: "Ферритин",
        value: "2,2",
        at: "2026-08-10T08:00:00.000Z",
      }),
      // glucose: within → within, both inside the period → unchanged (baseline = first in period).
      observation({
        id: "g1",
        code: "glucose.fasting",
        name: "Глюкоза",
        value: "2,0",
        at: "2026-07-01T08:00:00.000Z",
      }),
      observation({
        id: "g2",
        code: "glucose.fasting",
        name: "Глюкоза",
        value: "2,4",
        at: "2026-08-10T08:00:00.000Z",
      }),
      // ldl: a single measurement in the period, nothing before → first measured.
      observation({
        id: "l1",
        code: "cholesterol.ldl",
        name: "ЛПНП",
        value: "3,0",
        at: "2026-08-01T08:00:00.000Z",
      }),
      // hemoglobin: measured only before the period → not counted.
      observation({
        id: "h1",
        code: "hemoglobin",
        name: "Гемоглобин",
        value: "2,0",
        at: "2024-01-10T08:00:00.000Z",
      }),
    ],
    null,
  );
  const summary = historySummary(series, "6m", now);
  const byKind = Object.fromEntries(
    summary.buckets.map((bucket) => [bucket.kind, bucket.series.map((entry) => entry.code)]),
  );
  assert.deepEqual(byKind, {
    moved_outside: ["tsh"],
    returned_inside: ["ferritin"],
    unchanged: ["glucose.fasting"],
    first_measured: ["cholesterol.ldl"],
  });
  assert.equal(summary.measuredCount, 4, "the hemoglobin series has no point in the period");
});

test("«всё» compares the first-ever point to the latest; a one-point series is first-measured", () => {
  const series = buildDossierSeries(
    [
      observation({ id: "a1", value: "2,0", at: "2024-01-10T08:00:00.000Z" }),
      observation({ id: "a2", value: "9,9", at: "2026-08-10T08:00:00.000Z" }),
      observation({
        id: "b1",
        code: "ferritin",
        name: "Ферритин",
        value: "3,0",
        at: "2026-08-10T08:00:00.000Z",
      }),
    ],
    null,
  );
  const summary = historySummary(series, "all", now);
  const byKind = Object.fromEntries(
    summary.buckets.map((bucket) => [bucket.kind, bucket.series.map((entry) => entry.code)]),
  );
  assert.deepEqual(byKind.moved_outside, ["tsh"]);
  assert.deepEqual(byKind.first_measured, ["ferritin"]);
});

test("a point exactly on the boundary belongs to the period", () => {
  const series = buildDossierSeries(
    [observation({ id: "e1", value: "2,0", at: "2026-02-20T12:00:00.000Z" })],
    null,
  );
  const summary = historySummary(series, "6m", now);
  assert.equal(summary.measuredCount, 1);
});

test("the chart's default selection is the first outside series, else the first", () => {
  const calm = buildDossierSeries([observation({ id: "c", value: "2,2" })], null);
  const mixed = buildDossierSeries(
    [
      observation({ id: "w", code: "glucose.fasting", name: "Глюкоза", value: "2,2" }),
      observation({ id: "o", code: "tsh", value: "9,9" }),
    ],
    null,
  );
  assert.equal(defaultSelectionKey(calm), calm[0]?.key ?? null);
  assert.equal(defaultSelectionKey(mixed), mixed.find((s) => s.code === "tsh")?.key);
  assert.equal(defaultSelectionKey([]), null);
});
