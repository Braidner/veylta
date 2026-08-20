import assert from "node:assert/strict";
import test from "node:test";
import { buildDossierSeries } from "./dossier";
import { observation } from "./dossier.fixture";
import { chooseSelectionKey } from "./history-selection";
import { defaultSelectionKey } from "./history-summary";

/** Two indicators, one of them outside its printed range — the record the page chooses from. */
const series = buildDossierSeries(
  [
    observation({ id: "g1", code: "glucose.fasting", name: "Глюкоза", value: "2,2" }),
    observation({ id: "t1", code: "tsh", value: "9,9" }),
  ],
  null,
);

test("the reader's own choice stands while it still names a series", () => {
  const glucose = series.find((entry) => entry.code === "glucose.fasting");
  assert.equal(
    chooseSelectionKey({ local: glucose?.key ?? null, requestedCode: undefined, series }),
    glucose?.key,
  );
  // Even against a `?code=` pointing elsewhere: the URL asked once, the reader chose after.
  assert.equal(
    chooseSelectionKey({ local: glucose?.key ?? null, requestedCode: "tsh", series }),
    glucose?.key,
  );
});

test("a choice whose series is gone is dropped — the reload decides again", () => {
  assert.equal(
    chooseSelectionKey({ local: "cholesterol.ldl|ммоль/л", requestedCode: "tsh", series }),
    series.find((entry) => entry.code === "tsh")?.key,
  );
  assert.equal(
    chooseSelectionKey({ local: "cholesterol.ldl|ммоль/л", requestedCode: undefined, series }),
    defaultSelectionKey(series),
  );
});

test("a `?code=` picks the first series of that code — two printed units are two series", () => {
  const twoUnits = buildDossierSeries(
    [
      observation({ id: "a1", value: "2,0", unit: "мЕд/л" }),
      observation({ id: "a2", value: "9,9", unit: "мМЕ/л" }),
      observation({ id: "b1", code: "ferritin", name: "Ферритин", value: "3,0" }),
    ],
    null,
  );
  const first = twoUnits.find((entry) => entry.code === "tsh");
  assert.equal(
    chooseSelectionKey({ local: null, requestedCode: "tsh", series: twoUnits }),
    first?.key,
  );
});

test("with nothing chosen and nothing asked for, the record's default stands", () => {
  assert.equal(
    chooseSelectionKey({ local: null, requestedCode: undefined, series }),
    defaultSelectionKey(series),
    "the first series outside its reference",
  );
  assert.equal(
    chooseSelectionKey({ local: null, requestedCode: "hemoglobin", series }),
    defaultSelectionKey(series),
    "a code the record does not carry falls back the same way",
  );
});

test("an empty record selects nothing", () => {
  assert.equal(chooseSelectionKey({ local: null, requestedCode: undefined, series: [] }), null);
  assert.equal(chooseSelectionKey({ local: "tsh|мМЕ/л", requestedCode: "tsh", series: [] }), null);
});
