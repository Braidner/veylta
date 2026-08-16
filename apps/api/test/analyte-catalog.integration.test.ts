import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";
import {
  enrichFactFromAnalyteMappings,
  loadAnalyteCatalogForPrompt,
  normalizeAnalyteName,
  normalizeAnalyteUnit,
} from "../src/processing/analyte-mapping.js";
import type { StrictLabExtractionFact } from "../src/processing/synthetic-lab-parser.js";

function printedFact(sourceName: string, sourceValue: string, sourceUnit: string) {
  return {
    factKey: "printed",
    sourceName,
    sourceValue,
    sourceUnit,
    proposedCanonicalCode: null,
    proposedNormalizedValue: null,
    proposedNormalizedUnit: null,
    proposedSampledAt: null,
    proposedResultedAt: null,
    proposedSpecimenType: null,
    proposedLaboratory: null,
    referenceRange: null,
    confidence: 0.99,
    validationIssues: [],
    source: { pageNumber: 1, fragment: `${sourceName} ${sourceValue} ${sourceUnit}` },
  } satisfies StrictLabExtractionFact;
}

/**
 * The seeded catalog is data written by hand into a migration, so this test pins the two
 * things that would silently break mapping if they drifted: every alias key must be exactly
 * what the normalizers produce, and the printed spellings a report actually uses must resolve.
 */
test("the seeded analyte catalog resolves printed laboratory spellings deterministically", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-analyte-catalog-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);

    const aliases = await database.query<{
      canonical_code: string;
      source_name_key: string;
      source_unit_key: string;
    }>(
      "SELECT canonical_code, source_name_key, source_unit_key FROM analyte_aliases WHERE status = 'confirmed'",
    );
    for (const alias of aliases.rows) {
      assert.equal(alias.source_name_key, normalizeAnalyteName(alias.source_name_key));
      assert.equal(alias.source_unit_key, normalizeAnalyteUnit(alias.source_unit_key));
    }
    const catalog = await database.query<{ canonical_code: string; canonical_unit: string }>(
      "SELECT canonical_code, canonical_unit FROM analyte_catalog",
    );
    assert.ok(catalog.rows.length >= 90, `expected a seeded catalog, got ${catalog.rows.length}`);
    const aliasedCodes = new Set(aliases.rows.map((alias) => alias.canonical_code));
    // The two synthetic demonstration analytes are mapped by the fixture parser, not by alias.
    for (const entry of catalog.rows.filter(
      (row) => !row.canonical_code.startsWith("synthetic-"),
    )) {
      assert.ok(aliasedCodes.has(entry.canonical_code), `${entry.canonical_code} has no alias`);
      // Every canonical unit has an identity alias, so a report printing that unit normalises.
      assert.ok(
        aliases.rows.some(
          (alias) =>
            alias.canonical_code === entry.canonical_code &&
            alias.source_unit_key === normalizeAnalyteUnit(entry.canonical_unit),
        ),
        `${entry.canonical_code} has no alias in its canonical unit`,
      );
    }

    // Spellings as a Russian laboratory prints them, values as the PDF text layer carries them.
    const resolved = async (name: string, value: string, unit: string) => {
      const fact = await enrichFactFromAnalyteMappings(database, printedFact(name, value, unit));
      return [
        fact.proposedCanonicalCode,
        fact.proposedNormalizedValue,
        fact.proposedNormalizedUnit,
      ];
    };
    assert.deepEqual(await resolved("Гемоглобин (Hb)", "153", "г/л"), ["hemoglobin", "153", "g/L"]);
    assert.deepEqual(await resolved("Общее количество лейкоцитов (WBC)", "5,14", "10 9 /л"), [
      "leukocytes",
      "5.14",
      "10^9/L",
    ]);
    assert.deepEqual(await resolved("Тромбоциты (PLT)", "213", "×10⁹/л"), [
      "platelets",
      "213",
      "10^9/L",
    ]);
    assert.deepEqual(await resolved("Тиреотропный гормон (ТТГ)", "1,54", "мМЕ/л"), [
      "tsh",
      "1.54",
      "mIU/L",
    ]);
    assert.deepEqual(await resolved("Креатинин", "65,5", "мкмоль/л"), [
      "creatinine",
      "65.5",
      "µmol/L",
    ]);
    assert.deepEqual(await resolved("Аланинаминотрансфераза (ALT)", "52,48", "Ед/л"), [
      "alt",
      "52.48",
      "U/L",
    ]);
    assert.deepEqual(await resolved("СОЭ", "4", "мм/час"), ["esr", "4", "mm/h"]);
    assert.deepEqual(await resolved("Билирубин общий (TB)", "9,9", "мкмоль/л"), [
      "bilirubin.total",
      "9.9",
      "µmol/L",
    ]);
    // A printed unit that is not the canonical one applies the code but converts nothing.
    assert.deepEqual(await resolved("Ферритин", "317", "мкг/л"), ["ferritin", null, null]);
    // Unknown spellings stay unresolved rather than guessed.
    assert.deepEqual(await resolved("Синтетический показатель Z", "1", "ед."), [null, null, null]);

    // The prompt sees every code with its unit and a bounded set of confirmed spellings.
    const promptCatalog = await loadAnalyteCatalogForPrompt(database);
    const hemoglobin = promptCatalog.find((entry) => entry.code === "hemoglobin");
    assert.equal(hemoglobin?.unit, "g/L");
    assert.ok(hemoglobin !== undefined && hemoglobin.aliases.length > 0);
    assert.ok(hemoglobin.aliases.length <= 6);
    assert.ok(hemoglobin.aliases.includes("гемоглобин (hb)"));
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
