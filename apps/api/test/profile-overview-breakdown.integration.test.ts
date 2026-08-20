import assert from "node:assert/strict";
import test from "node:test";
import { indicatorKey, type ProfileOverviewResponse } from "@veylta/contracts";
import { startAssistantApp } from "./assistant-app.js";
import { reviewSyntheticFacts, type SyntheticReviewDecision } from "./confirmed-observations.js";
import { type DocumentTestContext, uploadAndExtract } from "./document-app.js";
import { type Identity, register } from "./medical-profile-app.js";
import { createSyntheticIntelligence } from "./synthetic-intelligence.js";

const correction = (sourceName: string, sourceValue: string, sourceUnit: string) =>
  ({ decision: "correct", correction: { sourceName, sourceValue, sourceUnit } }) as const;

/**
 * A run of the synthetic fixture whose analyte b carries no printed reference at all — the
 * shape a laboratory prints for a value it states without bounds. Everything else is the
 * ordinary path: the same facts, the same review, the same confirmed observations.
 */
const withoutAnalyteBReference = createSyntheticIntelligence({
  mapItems: (items) =>
    items.map((item) =>
      item.factKey === "synthetic-analyte-b" ? { ...item, referenceRange: null } : item,
    ),
});

async function confirmReport(
  context: DocumentTestContext,
  owner: Identity,
  marker: string,
  decide: (factKey: string) => SyntheticReviewDecision,
  intelligence?: ReturnType<typeof createSyntheticIntelligence>,
): Promise<void> {
  const prepared = await uploadAndExtract(context, owner, {
    marker,
    ...(intelligence === undefined ? {} : { intelligence }),
  });
  await reviewSyntheticFacts(context.app, owner, prepared.documentId, prepared.facts, decide);
}

/**
 * Within, outside and unknown partition the record. The trap this pins is the unknown one: a
 * value with nothing to compare it against reads like an ordinary number, and counting it as
 * «в норме» would tell a person the record says something it never said.
 */
test("the record breaks down into within, outside and unknown, and the three are all of it", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  const context = { app, database, storageRoot };
  try {
    const owner = await register(app, "Overview breakdown owner");

    // Analyte a is printed 5.0–8.0: ТТГ 9.9 sits above it. Analyte b arrives without a printed
    // reference, so 140 г/л — a haemoglobin that looks perfectly ordinary — cannot be placed.
    await confirmReport(
      context,
      owner,
      "overview-breakdown-first",
      (factKey) =>
        factKey === "synthetic-analyte-a"
          ? correction("ТТГ", "9.9", "мМЕ/л")
          : correction("Гемоглобин", "140", "г/л"),
      withoutAnalyteBReference,
    );
    // The same printed 5.0–8.0, now with a value inside it, under an indicator of its own.
    await confirmReport(context, owner, "overview-breakdown-second", (factKey) =>
      factKey === "synthetic-analyte-a" ? correction("Глюкоза", "6.0", "ммоль/л") : "reject",
    );

    const response = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/overview`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200, response.body);
    const overview = response.json() as ProfileOverviewResponse;

    assert.equal(overview.outsideIndicatorCount, 1, "ТТГ 9.9 is above its printed bounds");
    assert.equal(overview.withinIndicatorCount, 1, "Глюкоза 6.0 sits inside its printed bounds");
    assert.equal(
      overview.unknownIndicatorCount,
      1,
      "the haemoglobin has no printed bounds and no laboratory mark, so it is not «в норме»",
    );

    const confirmed = await database.query<{
      canonical_code: string | null;
      source_name: string;
      source_unit: string;
    }>(
      `SELECT canonical_code, source_name, source_unit FROM observations
        WHERE family_id = $1 AND patient_profile_id = $2 AND status = 'confirmed'`,
      [owner.body.family.id, owner.body.profile.id],
    );
    const indicators = new Set(
      confirmed.rows.map((row) =>
        indicatorKey(row.canonical_code, row.source_name, row.source_unit),
      ),
    );
    assert.equal(
      overview.withinIndicatorCount +
        overview.outsideIndicatorCount +
        overview.unknownIndicatorCount,
      indicators.size,
      "the three counts are the whole record: no indicator is counted twice or left out",
    );
  } finally {
    await close();
  }
});
