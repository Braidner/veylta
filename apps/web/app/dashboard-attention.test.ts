import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewAttention, ProfileOverviewResponse } from "@veylta/contracts";
import { attentionRemainderCopy, attentionRows } from "./dashboard-attention";
import { gaugeScale, type ScaleReading } from "./dossier-scale";

const point = (value: string, at = "2026-05-14T00:00:00.000Z") => ({ value, at });

/** Three readings, so the row must reach for the last two rather than the run's start. */
function attention(overrides: Partial<ProfileOverviewAttention> = {}): ProfileOverviewAttention {
  return {
    canonicalCode: "tsh",
    name: "ТТГ",
    value: "6,5",
    unit: "мЕд/л",
    status: "above",
    range: "0,4 – 4,0",
    points: [
      point("3,1", "2026-03-02T00:00:00.000Z"),
      point("4,4"),
      point("6,5", "2026-06-20T00:00:00.000Z"),
    ],
    ...overrides,
  };
}

function overview(entries: readonly ProfileOverviewAttention[], outside = entries.length) {
  return {
    profile: { handle: "ivan" },
    outsideIndicatorCount: outside,
    attention: entries,
  } as unknown as ProfileOverviewResponse;
}

test("a row names the value, where it stands, how it moved and who reads it", () => {
  const [row] = attentionRows(overview([attention()]));

  assert.equal(row?.name, "ТТГ");
  assert.equal(row?.value, "6,5 мЕд/л");
  assert.equal(row?.standing, "выше 0,4 – 4,0");
  assert.equal(row?.change, "+2,1 с 14 мая", "the last two points, not the start of the run");
  assert.equal(row?.reader, "эндокринолог");
  assert.equal(row?.href, "/ivan/history?code=tsh");
});

test("the standing follows the status and the printed bounds, never a judgement", () => {
  const rows = attentionRows(
    overview([
      attention({ canonicalCode: "hemoglobin", status: "below", range: "120 – 160" }),
      attention({ canonicalCode: "ferritin", status: "flagged", range: "10 – 120" }),
      attention({ canonicalCode: "cortisol", status: "flagged", range: null }),
      attention({ canonicalCode: "inr", status: "above", range: null }),
    ]),
  );

  assert.deepEqual(
    rows.map((row) => row.standing),
    [
      "ниже 120 – 160",
      "лаборатория отметила значение",
      "лаборатория отметила значение вне диапазона",
      "референс не напечатан",
    ],
  );
});

test("the change needs two plain numbers, and an unchanged value says so", () => {
  const rows = attentionRows(
    overview([
      attention({ points: [point("6,5")] }),
      attention({ value: "< 0,1", points: [point("0,3"), point("< 0,1")] }),
      attention({ points: [point("отр."), point("6,5")] }),
      attention({ value: "6,5", points: [point("6,5"), point("6,5")] }),
    ]),
  );

  assert.deepEqual(
    rows.map((row) => row.change),
    [null, null, null, "без изменений с 14 мая"],
  );
});

test("an indicator the catalog does not name is read by the therapist, from the dossier", () => {
  const [row] = attentionRows(
    overview([attention({ canonicalCode: null, name: "Неизвестный показатель" })]),
  );

  assert.equal(row?.reader, "терапевт");
  assert.equal(row?.href, "/ivan/dossier");
});

test("the remainder counts what the rows do not name", () => {
  assert.equal(attentionRemainderCopy(overview([attention()], 5)), "и ещё 4");
  assert.equal(attentionRemainderCopy(overview([attention()], 1)), null);
  assert.equal(attentionRemainderCopy(overview([], 0)), null);
});

test("a row carries the reading the gauge places and the run the sparkline draws", () => {
  const [row] = attentionRows(overview([attention()]));

  assert.deepEqual(row?.reading, {
    value: 6.5,
    low: 0.4,
    high: 4,
    lowText: "0,4",
    highText: "4,0",
  });
  assert.deepEqual(row?.band, { low: 0.4, high: 4 });
  assert.deepEqual(
    row?.run.map((point) => point.value),
    [3.1, 4.4, 6.5],
  );
  assert.equal(new Set(row?.run.map((point) => point.id)).size, 3, "every point draws once");
  assert.equal(row?.runLabel, "ТТГ: 3 значения во времени");
});

test("without printed bounds there is no band and no scale to draw — never a fabricated one", () => {
  const [row] = attentionRows(overview([attention({ status: "flagged", range: null })]));

  assert.deepEqual(row?.reading, {
    value: 6.5,
    low: null,
    high: null,
    lowText: null,
    highText: null,
  });
  assert.equal(gaugeScale(row?.reading as ScaleReading), null);
  assert.equal(row?.band, null);
});

test("a reading that is not one number keeps its slot in the run and marks nothing", () => {
  const [row] = attentionRows(
    overview([attention({ value: "< 0,1", points: [point("0,3"), point("< 0,1")] })]),
  );

  assert.equal(row?.reading.value, null);
  assert.deepEqual(
    row?.run.map((entry) => entry.value),
    [0.3, null],
  );
  assert.equal(row?.runLabel, "ТТГ: 2 значения во времени");
});
