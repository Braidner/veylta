import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";
import { enrichFactFromAnalyteMappings } from "../src/processing/analyte-mapping.js";

test("the local analyte catalog maps equivalent laboratory labels without mutating source data", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-analyte-mapping-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
    const enriched = await enrichFactFromAnalyteMappings(database, {
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
    });

    assert.deepEqual(
      {
        canonicalCode: enriched.proposedCanonicalCode,
        normalizedValue: enriched.proposedNormalizedValue,
        normalizedUnit: enriched.proposedNormalizedUnit,
        sourceValue: enriched.sourceValue,
        sourceUnit: enriched.sourceUnit,
      },
      {
        canonicalCode: "bilirubin.total",
        normalizedValue: "9.9",
        normalizedUnit: "µmol/L",
        sourceValue: "9,9",
        sourceUnit: "мкмоль/л",
      },
    );

    assert.equal(await migrateDown(database), "0026_document_reasoning_effort");
    assert.equal(await migrateDown(database), "0025_run_diagnostics");
    assert.equal(await migrateDown(database), "0024_document_agent_threads");
    assert.equal(await migrateDown(database), "0023_document_lifecycle");
    assert.equal(await migrateDown(database), "0022_document_intelligence_v2");
    assert.equal(await migrateDown(database), "0021_codex_preferences");
    assert.equal(await migrateDown(database), "0020_processing_activity");
    assert.equal(await migrateDown(database), "0019_document_agent");
    assert.equal(await migrateDown(database), "0018_document_reanalysis");
    assert.equal(await migrateDown(database), "0017_analyte_catalog");
    await assert.rejects(() => database.query("SELECT * FROM analyte_aliases"), /no such table/);
    assert.deepEqual(await migrateUp(database), [
      "0017_analyte_catalog",
      "0018_document_reanalysis",
      "0019_document_agent",
      "0020_processing_activity",
      "0021_codex_preferences",
      "0022_document_intelligence_v2",
      "0023_document_lifecycle",
      "0024_document_agent_threads",
      "0025_run_diagnostics",
      "0026_document_reasoning_effort",
    ]);
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
