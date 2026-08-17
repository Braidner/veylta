import assert from "node:assert/strict";
import test from "node:test";
import type { ObservationHistoryItem } from "@veylta/contracts";
import { attentionBySpecialty, buildDossierSeries, seriesAssessment } from "./dossier";

function observation(
  overrides: Partial<{
    id: string;
    code: string | null;
    name: string;
    value: string;
    unit: string;
    at: string;
    low: string | null;
    high: string | null;
    flag: boolean | null;
    text: string | null;
  }>,
): ObservationHistoryItem {
  const at = overrides.at ?? "2026-08-10T08:00:00.000Z";
  return {
    id: overrides.id ?? `o-${at}`,
    canonicalCode: overrides.code === undefined ? "tsh" : overrides.code,
    source: {
      name: overrides.name ?? "ТТГ",
      value: overrides.value ?? "6,8",
      unit: overrides.unit ?? "мМЕ/л",
    },
    normalized: { value: null, unit: null, conversionVersion: null },
    referenceRange:
      overrides.low === null && overrides.high === null && overrides.text === null
        ? null
        : {
            sourceText: overrides.text ?? "0,4 - 4,0",
            sourceLow: overrides.low === undefined ? "0,4" : overrides.low,
            sourceHigh: overrides.high === undefined ? "4,0" : overrides.high,
            sourceUnit: overrides.unit ?? "мМЕ/л",
            laboratoryOutOfRange: overrides.flag ?? null,
            normalizedLow: null,
            normalizedHigh: null,
            normalizedUnit: null,
            conversionVersion: null,
          },
    dates: { sampledAt: at, resultedAt: null, uploadedAt: at },
    timelineAt: at,
    specimenType: null,
    laboratory: "Синтетическая лаборатория",
    extractionConfidence: 0.9,
    confirmed: { at, by: { id: "u", displayName: "Владелец" } },
    sourceDocument: {
      id: "d",
      versionId: "v",
      pageNumber: 1,
      fragment: "ТТГ 6,8 мМЕ/л 0,4 - 4,0",
      contentPath: "/v1/x",
    },
  };
}

test("series are built per analyte and unit, ordered in time, with the printed range read as numbers", () => {
  const series = buildDossierSeries(
    [
      observation({ id: "new", value: "6,8", at: "2026-08-10T08:00:00.000Z" }),
      observation({ id: "old", value: "4,7", at: "2026-02-10T08:00:00.000Z" }),
      observation({
        id: "hb",
        code: "hemoglobin",
        name: "Гемоглобин",
        value: "153",
        unit: "г/л",
        low: "139",
        high: "167",
      }),
      observation({
        id: "same-name-other-unit",
        value: "3,1",
        unit: "мкМЕ/мл",
        low: "0,3",
        high: "4,2",
      }),
    ],
    "female",
  );
  assert.deepEqual(
    series.map((item) => [item.key, item.area, item.specialty, item.points.length]),
    [
      ["hemoglobin|г/л", "blood", "hematologist", 1],
      ["tsh|мкМЕ/мл", "thyroid", "endocrinologist", 1],
      ["tsh|мМЕ/л", "thyroid", "endocrinologist", 2],
    ],
  );
  const tsh = series.find((item) => item.key === "tsh|мМЕ/л");
  assert.deepEqual(
    tsh?.points.map((point) => [point.observationId, point.value, point.status]),
    [
      ["old", 4.7, "above"],
      ["new", 6.8, "above"],
    ],
  );
  assert.equal(tsh?.latest.observationId, "new");
  assert.equal(tsh?.status, "above");
  assert.equal(tsh?.streak, 2);
  assert.deepEqual(tsh?.delta, { value: "+2,1", direction: "increased" });
});

test("status comes from the printed bounds, then from the laboratory's own flag, else unknown", () => {
  const [flagged] = buildDossierSeries(
    [
      observation({
        id: "f",
        value: "9,9",
        low: null,
        high: null,
        text: "см. комментарий",
        flag: true,
      }),
    ],
    null,
  );
  assert.equal(flagged?.status, "flagged");
  const [below] = buildDossierSeries([observation({ value: "0,2" })], null);
  assert.equal(below?.status, "below");
  const [within] = buildDossierSeries([observation({ value: "2,2" })], null);
  assert.equal(within?.status, "within");
  const [unknown] = buildDossierSeries([observation({ low: null, high: null, text: null })], null);
  assert.equal(unknown?.status, "unknown");
  const [comparison] = buildDossierSeries(
    [observation({ value: "< 0,1", text: "< 5", low: null, high: "5" })],
    null,
  );
  assert.equal(comparison?.status, "unknown", "a comparison value has no number to compare");
});

test("the assessment says what the value does against its range and where to take it", () => {
  const [above] = buildDossierSeries(
    [
      observation({ id: "n", value: "6,8", at: "2026-08-10T08:00:00.000Z" }),
      observation({ id: "o", value: "4,7", at: "2026-02-10T08:00:00.000Z" }),
    ],
    "female",
  );
  assert.ok(above);
  const assessment = seriesAssessment(above);
  assert.equal(assessment.tone, "watch");
  assert.match(assessment.headline, /^Выше референса/);
  assert.match(assessment.detail, /\+2,1/);
  assert.match(assessment.detail, /второй раз подряд/);
  assert.equal(assessment.nextStep?.specialty, "endocrinologist");
  assert.match(assessment.nextStep?.copy ?? "", /эндокринолог/);

  const [within] = buildDossierSeries([observation({ value: "2,2" })], null);
  assert.ok(within);
  const calm = seriesAssessment(within);
  assert.equal(calm.tone, "calm");
  assert.equal(calm.nextStep, null);
});

test("attention groups out-of-range indicators by the specialty that reads them", () => {
  const series = buildDossierSeries(
    [
      observation({ id: "t", value: "6,8" }),
      observation({
        id: "h",
        code: "hemoglobin",
        name: "Гемоглобин",
        value: "120",
        unit: "г/л",
        low: "139",
        high: "167",
      }),
      observation({
        id: "c",
        code: "crp",
        name: "СРБ",
        value: "12",
        unit: "мг/л",
        low: null,
        high: "5",
        text: "< 5",
      }),
      observation({
        id: "ok",
        code: "glucose",
        name: "Глюкоза",
        value: "4,6",
        unit: "ммоль/л",
        low: "3,9",
        high: "5,8",
      }),
    ],
    "male",
  );
  assert.deepEqual(
    attentionBySpecialty(series).map((group) => [
      group.specialty,
      group.series.map((item) => item.code),
    ]),
    [
      ["endocrinologist", ["tsh"]],
      ["hematologist", ["hemoglobin"]],
      [null, ["crp"]],
    ],
  );
});
