import assert from "node:assert/strict";
import test from "node:test";
import { startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { register } from "./medical-profile-app.js";

// A correction is the reviewer saying what the source really printed. The catalog is asked
// about the corrected name and unit; a spelling the catalog does not know keeps the model's
// proposal, so a series survives a typo fix while a rename to another analyte moves it.
test("a corrected result maps its analyte by the corrected name and unit", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Correction owner");
    const seeded = await confirmSyntheticReport(app, database, storageRoot, owner, (factKey) =>
      factKey === "synthetic-analyte-a"
        ? {
            decision: "correct",
            correction: { sourceName: "ТТГ", sourceValue: "6.8", sourceUnit: "мМЕ/л" },
          }
        : {
            decision: "correct",
            correction: {
              sourceName: "Синтетический аналит B (уточнено)",
              sourceValue: "12.6",
              sourceUnit: "synthetic-unit",
            },
          },
    );
    const rows = await database.transaction((client) =>
      client.query<{ id: string; canonical_code: string | null; source_name: string }>(
        `SELECT id, canonical_code, source_name FROM observations
          WHERE family_id = $1 ORDER BY created_at, rowid`,
        [owner.body.family.id],
      ),
    );
    assert.deepEqual(
      rows.rows.map((row) => [row.source_name, row.canonical_code]),
      [
        ["ТТГ", "tsh"],
        // A spelling the catalog does not know keeps the extractor's proposal.
        ["Синтетический аналит B (уточнено)", "synthetic-analyte-b"],
      ],
    );
    assert.equal(seeded.observationIds.length, 2);
  } finally {
    await close();
  }
});
