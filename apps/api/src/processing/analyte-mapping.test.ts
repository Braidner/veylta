import assert from "node:assert/strict";
import test from "node:test";
import type { DatabaseClient } from "../database/pool.js";
import {
  enrichFactFromAnalyteMappings,
  normalizeAnalyteName,
  normalizeAnalyteUnit,
} from "./analyte-mapping.js";
import type { StrictLabExtractionFact } from "./synthetic-lab-parser.js";

const bilirubinFact: StrictLabExtractionFact = {
  factKey: "bilirubin-total",
  sourceName: "Билирубин общий (ТВ)",
  sourceValue: "9,9",
  sourceUnit: "мкмоль/л",
  proposedCanonicalCode: null,
  proposedNormalizedValue: null,
  proposedNormalizedUnit: null,
  proposedSampledAt: null,
  proposedResultedAt: null,
  proposedSpecimenType: null,
  proposedLaboratory: "Лаборатория A",
  referenceRange: null,
  confidence: 0.99,
  validationIssues: [],
  source: { pageNumber: 2, fragment: "9,9 Билирубин общий (ТВ) мкмоль/л 3,4 - 20,5" },
};

function mappingDatabase(rows: readonly object[]): DatabaseClient {
  return {
    async exec() {},
    async query<Row extends object>() {
      return { rows: rows as Row[], rowCount: rows.length };
    },
  };
}

test("normalizes common laboratory spelling without losing the source value", () => {
  assert.equal(normalizeAnalyteName("  Билирубин  общий (ТВ) "), "билирубин общий (тв)");
  assert.equal(normalizeAnalyteUnit("мкмоль / л"), "umol/l");
  assert.equal(normalizeAnalyteUnit("µmol/L"), "umol/l");
});

/**
 * A Russian unit spelling and its Latin canonical form are one unit: the key must not depend
 * on the alphabet, or "г/л" and "g/L" would never be recognised as the same unit.
 */
test("a unit key is the same whether the unit is printed in Cyrillic or Latin", () => {
  const same = (cyrillic: string, latin: string, key: string) => {
    assert.equal(normalizeAnalyteUnit(cyrillic), key);
    assert.equal(normalizeAnalyteUnit(latin), key);
  };
  same("г/л", "g/L", "g/l");
  same("мг/л", "mg/L", "mg/l");
  same("мкг/л", "µg/L", "ug/l");
  same("нг/мл", "ng/mL", "ng/ml");
  same("пг/мл", "pg/mL", "pg/ml");
  same("пг", "pg", "pg");
  same("фл", "fL", "fl");
  same("ммоль/л", "mmol/L", "mmol/l");
  same("нмоль/л", "nmol/L", "nmol/l");
  same("пмоль/л", "pmol/L", "pmol/l");
  same("Ед/л", "U/L", "u/l");
  same("Е/л", "U/L", "u/l");
  same("МЕ/мл", "IU/mL", "iu/ml");
  same("мМЕ/л", "mIU/L", "miu/l");
  same("мкМЕ/мл", "µIU/mL", "uiu/ml");
  same("мЕд/л", "mU/L", "mu/l");
  same("мм/час", "mm/h", "mm/h");
  same("мм/ч", "mm/h", "mm/h");
  same("сек", "s", "s");
  same("%", "%", "%");
  // Powers of ten come printed as 10^9, 10*9, ×10⁹ or, out of a PDF text layer, "10 9 /л".
  same("10 9 /л", "10^9/L", "109/l");
  same("×10⁹/л", "10*9/L", "109/l");
  same("х10¹²/л", "10^12/L", "1012/l");
  same("тыс/мкл", "10^3/µL", "103/ul");
  same("млн/мкл", "10^6/µL", "106/ul");
  same("мэкв/л", "mEq/L", "meq/l");
  // Existing keys stay stable.
  assert.equal(normalizeAnalyteUnit("synthetic-unit"), "synthetic-unit");
  assert.equal(normalizeAnalyteUnit("мкмоль/л"), "umol/l");
});

test("maps one laboratory alias to a stable household code and comparable unit", async () => {
  const enriched = await enrichFactFromAnalyteMappings(
    mappingDatabase([
      {
        canonical_code: "bilirubin.total",
        canonical_unit: "µmol/L",
        source_name_key: "билирубин общий (тв)",
        source_unit_key: "umol/l",
      },
    ]),
    bilirubinFact,
  );

  assert.deepEqual(
    {
      canonicalCode: enriched.proposedCanonicalCode,
      normalizedUnit: enriched.proposedNormalizedUnit,
      normalizedValue: enriched.proposedNormalizedValue,
      sourceName: enriched.sourceName,
      sourceUnit: enriched.sourceUnit,
      sourceValue: enriched.sourceValue,
    },
    {
      canonicalCode: "bilirubin.total",
      normalizedUnit: "µmol/L",
      normalizedValue: "9.9",
      sourceName: "Билирубин общий (ТВ)",
      sourceUnit: "мкмоль/л",
      sourceValue: "9,9",
    },
  );
});

test("the normalized value is derived from the printed value, never taken from the model", async () => {
  const alias = {
    canonical_code: "bilirubin.total",
    canonical_unit: "µmol/L",
    source_name_key: "билирубин общий (тв)",
    source_unit_key: "umol/l",
  };
  // A model-proposed conversion that contradicts the printed number is not carried over.
  const enriched = await enrichFactFromAnalyteMappings(mappingDatabase([alias]), {
    ...bilirubinFact,
    proposedNormalizedValue: "9.4",
    proposedNormalizedUnit: "µmol/L",
  });
  assert.equal(enriched.proposedNormalizedValue, "9.9");
  assert.equal(enriched.proposedNormalizedUnit, "µmol/L");

  // An alias whose unit is not the canonical unit would need a real conversion, which Veylta
  // does not perform: the code is applied, the normalization stays empty.
  const converted = await enrichFactFromAnalyteMappings(
    mappingDatabase([{ ...alias, canonical_unit: "mg/dL", source_unit_key: "umol/l" }]),
    bilirubinFact,
  );
  assert.equal(converted.proposedCanonicalCode, "bilirubin.total");
  assert.equal(converted.proposedNormalizedValue, null);
  assert.equal(converted.proposedNormalizedUnit, null);
});

test("keeps an unknown analyte unresolved instead of inventing a mapping", async () => {
  const enriched = await enrichFactFromAnalyteMappings(mappingDatabase([]), bilirubinFact);
  assert.deepEqual(enriched, bilirubinFact);
});
