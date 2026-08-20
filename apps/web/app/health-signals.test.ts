import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { EMPTY_RECORD_COPY, signalChips, signalsStrip } from "./health-signals";

function overview(overrides: Partial<ProfileOverviewResponse> = {}): ProfileOverviewResponse {
  return {
    profile: { handle: "ivan" },
    outsideIndicatorCount: 0,
    withinIndicatorCount: 0,
    unknownIndicatorCount: 0,
    documentCount: 0,
    recentDocuments: [],
    reviewQueue: {
      documentCount: 0,
      pendingFactCount: 0,
      needsAttentionFactCount: 0,
      documents: [],
    },
    ...overrides,
  } as unknown as ProfileOverviewResponse;
}

const record = overview({
  outsideIndicatorCount: 3,
  withinIndicatorCount: 18,
  unknownIndicatorCount: 4,
});

test("the strip is the record's three named states, each carrying its own word", () => {
  const strip = signalsStrip(record);

  assert.equal(strip.total, 25);
  assert.deepEqual(
    strip.segments.map((segment) => [segment.key, segment.count, segment.label]),
    [
      ["outside", 3, "3 вне референса"],
      ["within", 18, "18 в пределах"],
      ["unknown", 4, "4 без референса"],
    ],
  );
  assert.equal(strip.label, "25 показателей · 3 вне референса · 18 в пределах · 4 без референса");
});

test("only the outside segment leads anywhere, and only while there is something outside", () => {
  assert.deepEqual(
    signalsStrip(record).segments.map((segment) => segment.href),
    ["/ivan/dossier", null, null],
  );
  const clean = signalsStrip(overview({ withinIndicatorCount: 6 }));
  assert.deepEqual(
    clean.segments.map((segment) => [segment.key, segment.href]),
    [["within", null]],
  );
});

test("a count of zero has no segment on the bar", () => {
  const strip = signalsStrip(overview({ outsideIndicatorCount: 1, unknownIndicatorCount: 2 }));

  assert.deepEqual(
    strip.segments.map((segment) => segment.key),
    ["outside", "unknown"],
  );
  assert.equal(strip.label, "3 показателя · 1 вне референса · 2 без референса");
});

test("a record with nothing confirmed says so instead of drawing an empty bar", () => {
  const strip = signalsStrip(overview());

  assert.equal(strip.total, 0);
  assert.deepEqual(strip.segments, []);
  assert.equal(strip.label, EMPTY_RECORD_COPY);
  assert.equal(
    EMPTY_RECORD_COPY,
    "Пока нет подтверждённых значений — они появятся после проверки документа",
  );
});

test("the bookkeeping is two chips, and only the waiting one is an action", () => {
  const chips = signalChips(
    overview({
      documentCount: 12,
      recentDocuments: [
        { effectiveDate: { value: "2026-08-20", source: "document" } },
      ] as unknown as ProfileOverviewResponse["recentDocuments"],
      reviewQueue: {
        documentCount: 1,
        pendingFactCount: 4,
        needsAttentionFactCount: 0,
        documents: [],
      },
    }),
  );

  assert.deepEqual(
    chips.map((chip) => [chip.key, chip.label, chip.href]),
    [
      ["review", "Ждёт проверки 4", "/ivan/docs"],
      ["documents", "Документов 12 · последний 20 августа", null],
    ],
  );
});

test("nothing waiting is still stated, but leads nowhere; an empty archive names no day", () => {
  const chips = signalChips(overview());

  assert.deepEqual(
    chips.map((chip) => [chip.label, chip.href]),
    [
      ["Ждёт проверки 0", null],
      ["Документов 0", null],
    ],
  );
});
