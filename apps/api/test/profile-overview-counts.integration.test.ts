import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport, type SyntheticReviewDecision } from "./confirmed-observations.js";
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
    assert.equal(afterFirst.contractVersion, "profile-overview/v5");
    assert.equal(afterFirst.confirmedCount, 2, "both decided facts became observations");
    assert.equal(afterFirst.confirmedCount, first.observationIds.length);
    assert.equal(afterFirst.outsideIndicatorCount, 1, "ТТГ is outside; analyte b is not");
    assert.deepEqual(
      afterFirst.attention,
      [
        {
          canonicalCode: "tsh",
          name: "ТТГ",
          value: "9.9",
          unit: "мМЕ/л",
          status: "above",
          range: "5.0–8.0 synthetic-unit",
          previous: null,
        },
      ],
      "the outside indicator is named, with the bounds the source printed and no earlier value",
    );

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
      afterSecond.outsideIndicatorCount,
      1,
      "two outside values of one indicator are one indicator outside, not two",
    );
    const firstReading = afterFirst.recentObservations.find(
      (item) => item.source.value === "9.9",
    )?.timelineAt;
    assert.deepEqual(
      afterSecond.attention.map((item) => [item.value, item.previous]),
      [["9.5", { value: "9.9", at: firstReading }]],
      "the newest value stands, the one before it carries the change",
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
      afterThird.outsideIndicatorCount,
      0,
      "the indicator's latest value is inside; the two older ones no longer count",
    );
    assert.deepEqual(
      afterThird.attention,
      [],
      "an indicator whose latest value came back inside is not named",
    );
  } finally {
    await close();
  }
});

/** Corrects both facts of a report to a distinct indicator, so one upload yields two of them. */
function correctBoth(
  a: readonly [string, string, string],
  b: readonly [string, string, string],
): (factKey: string) => SyntheticReviewDecision {
  const correction = ([sourceName, sourceValue, sourceUnit]: readonly [string, string, string]) =>
    ({ decision: "correct", correction: { sourceName, sourceValue, sourceUnit } }) as const;
  return (factKey) => (factKey === "synthetic-analyte-a" ? correction(a) : correction(b));
}

test("the overview names at most three indicators, the newest reading first", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Overview attention owner");
    // Analyte a is printed 5.0–8.0, analyte b 10.0–15.0; every corrected value sits above.
    await confirmSyntheticReport(
      app,
      database,
      storageRoot,
      owner,
      correctBoth(["ТТГ", "9.9", "мМЕ/л"], ["Гемоглобин", "180", "г/л"]),
      "overview-attention-first",
    );
    await confirmSyntheticReport(
      app,
      database,
      storageRoot,
      owner,
      correctBoth(["Глюкоза", "9.8", "ммоль/л"], ["СОЭ", "40", "мм/ч"]),
      "overview-attention-second",
    );

    const overview = await readOverview(app, owner);
    assert.equal(overview.outsideIndicatorCount, 4, "four indicators sit outside");
    assert.equal(overview.attention.length, 3, "the overview names three of them, not all four");
    assert.deepEqual(
      new Set(overview.attention.slice(0, 2).map((item) => item.name)),
      new Set(["Глюкоза", "СОЭ"]),
      "the second report is the newer reading, so its indicators come first",
    );
    assert.ok(
      ["ТТГ", "Гемоглобин"].includes(overview.attention[2]?.name ?? ""),
      "the third place goes to the older report",
    );
    assert.deepEqual(
      overview.attention.map((item) => item.previous),
      [null, null, null],
      "each indicator was confirmed once, so none carries an earlier value",
    );
  } finally {
    await close();
  }
});
