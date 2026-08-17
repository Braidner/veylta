import assert from "node:assert/strict";
import test from "node:test";
import { buildDossierSeries } from "./dossier";
import { observation } from "./dossier.fixture";
import { areaSummaries, readersCopy, statusCounts, statusLine } from "./dossier-areas";

const series = buildDossierSeries(
  [
    observation({
      id: "1",
      code: "hemoglobin",
      name: "Гемоглобин",
      value: "118",
      low: "120",
      high: "160",
    }),
    observation({
      id: "2",
      code: "leukocytes",
      name: "Лейкоциты",
      value: "6,1",
      low: "4",
      high: "9",
    }),
    observation({
      id: "3",
      code: "cholesterol.ldl",
      name: "ЛПНП",
      value: "4,9",
      low: null,
      high: "3,0",
    }),
    observation({
      id: "4",
      code: "crp",
      name: "СРБ",
      value: "< 1",
      low: null,
      high: null,
      text: null,
    }),
    observation({
      id: "5",
      code: null,
      name: "Нечто",
      value: "1",
      low: null,
      high: null,
      text: null,
    }),
  ],
  "female",
);

test("areas are summarised in the record's fixed order with what stands outside", () => {
  const summaries = areaSummaries(series);
  assert.deepEqual(
    summaries.map((summary) => [summary.area, summary.total, summary.outside, summary.unknown]),
    [
      ["blood", 2, 1, 0],
      ["lipids", 1, 1, 0],
      ["inflammation", 1, 0, 1],
      ["other", 1, 0, 1],
    ],
  );
  assert.equal(summaries[0]?.label, "Кровь");
  assert.deepEqual(summaries[0]?.readers, ["hematologist"]);
  assert.deepEqual(summaries[2]?.readers, [null]);
});

test("status counts and the status line read the whole record or one area alike", () => {
  assert.deepEqual(statusCounts(series), { total: 5, outside: 2, within: 1, unknown: 2 });
  assert.equal(
    statusLine(statusCounts(series)),
    "5 показателей · 2 вне референса · 1 в референсе · 2 без референса",
  );
  assert.equal(
    statusLine({ total: 1, outside: 0, within: 1, unknown: 0 }),
    "1 показатель · всё в референсе",
  );
  assert.equal(
    statusLine({ total: 0, outside: 0, within: 0, unknown: 0 }),
    "Пока нет подтверждённых значений",
  );
});

test("who reads an area is named from its specialties, the therapist when none is", () => {
  assert.equal(readersCopy(["cardiologist"]), "читает кардиолог");
  assert.equal(readersCopy(["hematologist", "cardiologist"]), "читают гематолог, кардиолог");
  assert.equal(readersCopy([null]), "читает терапевт");
  assert.equal(readersCopy([]), "читает терапевт");
});
