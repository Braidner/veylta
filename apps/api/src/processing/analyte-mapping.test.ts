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

test("keeps an unknown analyte unresolved instead of inventing a mapping", async () => {
  const enriched = await enrichFactFromAnalyteMappings(mappingDatabase([]), bilirubinFact);
  assert.deepEqual(enriched, bilirubinFact);
});
