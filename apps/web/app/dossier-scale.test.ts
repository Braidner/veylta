import assert from "node:assert/strict";
import test from "node:test";
import type { SeriesPoint } from "./dossier";
import { gaugeScale } from "./dossier-scale";

function point(overrides: Partial<SeriesPoint>): SeriesPoint {
  return {
    observationId: "o",
    at: "2026-08-10T08:00:00.000Z",
    printed: "5,0",
    value: 5,
    status: "within",
    rangeText: "3,5–5,5",
    low: 3.5,
    high: 5.5,
    lowText: "3,5",
    highText: "5,5",
    documentId: "d",
    ...overrides,
  };
}

const round = (value: number | null) => (value === null ? null : Math.round(value));

test("a two-sided reference sits in the middle of the track, the value marked inside it", () => {
  const scale = gaugeScale(point({}));
  assert.ok(scale !== null);
  assert.deepEqual([round(scale.band.from), round(scale.band.to)], [25, 75]);
  assert.equal(round(scale.marker), 63);
  assert.deepEqual([scale.lowLabel, scale.highLabel], ["3,5", "5,5"]);
});

test("a value outside the reference stretches the track so the marker stays visible", () => {
  const above = gaugeScale(point({ printed: "9,0", value: 9, status: "above" }));
  assert.ok(above !== null);
  assert.ok(above.marker !== null && above.marker > above.band.to && above.marker <= 100);
  assert.ok(above.band.from > 0);
  const below = gaugeScale(point({ printed: "1,0", value: 1, status: "below" }));
  assert.ok(below !== null);
  assert.ok(below.marker !== null && below.marker < below.band.from && below.marker >= 0);
});

test("a one-sided reference runs to the track's edge on its open side", () => {
  const upper = gaugeScale(
    point({ low: null, lowText: null, high: 3, highText: "3,0", value: 4.9, printed: "4,9" }),
  );
  assert.ok(upper !== null);
  assert.equal(upper.band.from, 0);
  assert.ok(upper.band.to < 100 && upper.marker !== null && upper.marker > upper.band.to);
  assert.deepEqual([upper.lowLabel, upper.highLabel], [null, "3,0"]);
  const lower = gaugeScale(
    point({ low: 60, lowText: "60", high: null, highText: null, value: 72, printed: "72" }),
  );
  assert.ok(lower !== null);
  assert.equal(lower.band.to, 100);
  assert.ok(lower.marker !== null && lower.marker > lower.band.from);
});

test("no printed bounds means no scale; a comparison value keeps the band and drops the marker", () => {
  assert.equal(gaugeScale(point({ low: null, high: null, lowText: null, highText: null })), null);
  const comparison = gaugeScale(point({ printed: "< 0,1", value: null }));
  assert.ok(comparison !== null);
  assert.equal(comparison.marker, null);
  assert.deepEqual([round(comparison.band.from), round(comparison.band.to)], [25, 75]);
});
