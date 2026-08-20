import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { type Identity, register } from "./medical-profile-app.js";

/**
 * Every report is the same synthetic fixture: analyte a printed 5.0–8.0, analyte b inside its
 * own range. The person corrects a to one indicator — ТТГ мМЕ/л — so three reports become three
 * values of one indicator, and the overview must count indicators rather than values.
 */
function reviewReport(value: string, keepAnalyteB: boolean) {
  return (factKey: string) =>
    factKey === "synthetic-analyte-a"
      ? {
          decision: "correct" as const,
          correction: { sourceName: "ТТГ", sourceValue: value, sourceUnit: "мМЕ/л" },
        }
      : keepAnalyteB
        ? ("confirm" as const)
        : ("reject" as const);
}

async function readOverview(
  app: Awaited<ReturnType<typeof startAssistantApp>>["app"],
  owner: Identity,
): Promise<ProfileOverviewResponse> {
  const response = await app.inject({
    method: "GET",
    url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/overview`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as ProfileOverviewResponse;
}

test("the overview counts the whole record: every confirmed value, and the indicators outside their range", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Overview counts owner");

    // First report: ТТГ 9.9 sits above the printed 5.0–8.0; analyte b as printed sits inside.
    const first = await confirmSyntheticReport(
      app,
      database,
      storageRoot,
      owner,
      reviewReport("9.9", true),
      "overview-counts-first",
    );
    const afterFirst = await readOverview(app, owner);
    assert.equal(afterFirst.contractVersion, "profile-overview/v4");
    assert.equal(afterFirst.confirmedCount, 2, "both decided facts became observations");
    assert.equal(afterFirst.confirmedCount, first.observationIds.length);
    assert.equal(afterFirst.outsideRangeCount, 1, "ТТГ is outside; analyte b is not");

    // Second report: another ТТГ above the same range. Two outside values, still one indicator.
    const second = await confirmSyntheticReport(
      app,
      database,
      storageRoot,
      owner,
      reviewReport("9.5", false),
      "overview-counts-second",
    );
    const afterSecond = await readOverview(app, owner);
    assert.equal(afterSecond.confirmedCount, 3);
    assert.equal(afterSecond.confirmedCount, second.observationIds.length);
    assert.equal(
      afterSecond.outsideRangeCount,
      1,
      "two outside values of one indicator are one indicator outside, not two",
    );

    // Third report: ТТГ back inside. The latest value decides, so the indicator stops counting.
    const third = await confirmSyntheticReport(
      app,
      database,
      storageRoot,
      owner,
      reviewReport("7.0", false),
      "overview-counts-third",
    );
    const afterThird = await readOverview(app, owner);
    assert.equal(afterThird.confirmedCount, 4);
    assert.equal(afterThird.confirmedCount, third.observationIds.length);
    assert.equal(
      afterThird.recentObservations.length,
      3,
      "the response still carries only three observations",
    );
    assert.equal(
      afterThird.recentObservations[0]?.source.value,
      "7.0",
      "the newest confirmed value is the third report's",
    );
    assert.ok(
      afterThird.confirmedCount > afterThird.recentObservations.length,
      "the count is the record's, not the length of what the response shows",
    );
    assert.equal(
      afterThird.outsideRangeCount,
      0,
      "the indicator's latest value is inside; the two older ones no longer count",
    );
  } finally {
    await close();
  }
});
