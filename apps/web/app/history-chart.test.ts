import assert from "node:assert/strict";
import test from "node:test";
import { buildDossierSeries } from "./dossier";
import { observation } from "./dossier.fixture";
import { historyChartModel } from "./history-chart";

const now = new Date("2026-08-20T12:00:00.000Z");

test("points are placed on the period's time axis with their status; the band steps when bounds change", () => {
  const [series] = buildDossierSeries(
    [
      observation({ id: "p1", value: "2,0", at: "2026-06-20T12:00:00.000Z" }),
      // The second laboratory prints a different range: the band must step, not average.
      observation({
        id: "p2",
        value: "9,9",
        low: "1,0",
        high: "8,0",
        text: "1,0 - 8,0",
        at: "2026-08-10T12:00:00.000Z",
      }),
    ],
    null,
  );
  assert.ok(series);
  const model = historyChartModel(series, "3m", now);
  assert.equal(model.empty, null);
  assert.equal(model.points.length, 2);
  const [first, second] = model.points;
  assert.ok(first && second);
  assert.ok(first.x < second.x, "time flows left to right");
  assert.ok(first.y > second.y, "a larger value sits higher (smaller y)");
  assert.equal(first.status, "within");
  assert.equal(second.status, "above");
  assert.equal(second.documentId, "d");
  assert.equal(model.band.length, 2, "two printed ranges → two stepped segments");
  const [b1, b2] = model.band;
  assert.ok(b1 && b2);
  assert.ok(b1.x2 <= b2.x1 + 0.001, "segments do not overlap");
  assert.notEqual(b1.yTop, b2.yTop, "the step is visible");
  assert.ok(model.ticks.length >= 2);
  assert.ok(model.yMaxLabel.includes("9"), "the y extent covers the largest value");
});

test("a bounded period opens with the earliest known bounds, not with an unshaded gap", () => {
  const [series] = buildDossierSeries(
    [
      // Both points sit inside the 3-month window; the first one starts it well past its left edge.
      observation({ id: "mid", value: "2,0", at: "2026-07-20T12:00:00.000Z" }),
      observation({ id: "late", value: "2,4", at: "2026-08-10T12:00:00.000Z" }),
    ],
    null,
  );
  assert.ok(series);
  const model = historyChartModel(series, "3m", now);
  const [first] = model.points;
  assert.ok(first !== undefined && first.x > 0, "the first value sits inside the window");
  assert.equal(model.band.length, 1, "one printed range → one segment");
  assert.equal(model.band[0]?.x1, 0, "the band reaches the period's left edge");
});

test("a series with no numeric point in the period is empty and says so", () => {
  const [series] = buildDossierSeries(
    [observation({ id: "old", value: "2,0", at: "2024-01-10T08:00:00.000Z" })],
    null,
  );
  assert.ok(series);
  const model = historyChartModel(series, "3m", now);
  assert.equal(model.empty, "no_numeric");
  assert.deepEqual(model.points, []);
});

test("non-numeric values are left to the table; the chart keeps only numbers", () => {
  const [series] = buildDossierSeries(
    [
      observation({ id: "n1", value: "< 0,1", at: "2026-08-01T08:00:00.000Z" }),
      observation({ id: "n2", value: "2,2", at: "2026-08-10T08:00:00.000Z" }),
    ],
    null,
  );
  assert.ok(series);
  const model = historyChartModel(series, "all", now);
  assert.equal(model.points.length, 1);
});
