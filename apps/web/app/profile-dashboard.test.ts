import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { signalChips, signalsStrip } from "./health-signals";
import { buildProfileDashboardModel } from "./profile-dashboard";

function overview(overrides: Partial<ProfileOverviewResponse> = {}): ProfileOverviewResponse {
  return {
    contractVersion: "profile-overview/v6",
    profile: {
      id: "00000000-0000-4000-8000-000000000002",
      familyId: "00000000-0000-4000-8000-000000000001",
      displayName: "Иван",
      handle: "ivan",
      kind: "adult",
      access: "owner",
      createdAt: "2026-08-01T09:00:00.000Z",
    },
    documentCount: 0,
    confirmedCount: 0,
    outsideIndicatorCount: 0,
    withinIndicatorCount: 0,
    unknownIndicatorCount: 0,
    attention: [],
    assistants: [],
    recentDocuments: [],
    reviewQueue: {
      documentCount: 0,
      pendingFactCount: 0,
      needsAttentionFactCount: 0,
      documents: [],
    },
    recentObservations: [],
    ...overrides,
  };
}

type OverviewDocument = ProfileOverviewResponse["recentDocuments"][number];

function overviewDocument(overrides: Partial<OverviewDocument> = {}): OverviewDocument {
  return {
    id: "00000000-0000-4000-8000-000000000030",
    originalFilename: "f754db29-cc7f-406a-9ed0-9f5c1d2e3a4b",
    contentType: "application/pdf",
    uploadedAt: "2026-08-16T09:00:00.000Z",
    effectiveDate: { value: "2026-08-14", source: "document" },
    intelligence: {
      contractVersion: "document-intelligence/v2",
      provider: "codex",
      modelId: "synthetic",
      runtimeVersion: "synthetic",
      category: "laboratory",
      title: "Общий анализ крови",
      shortSummary: "Синтетический отчёт",
      documentDate: "2026-08-14",
      confidence: 0.9,
    },
    processing: { state: "completed", updatedAt: "2026-08-16T10:00:00.000Z", factCount: 6 },
    ...overrides,
  };
}

test("medical navigator leads with the real review queue and source action", () => {
  const model = buildProfileDashboardModel(
    overview({
      reviewQueue: {
        documentCount: 1,
        pendingFactCount: 2,
        needsAttentionFactCount: 1,
        documents: [
          {
            id: "00000000-0000-4000-8000-000000000003",
            originalFilename: "synthetic-lab.pdf",
            contentType: "application/pdf",
            uploadedAt: "2026-08-12T09:00:00.000Z",
            pendingFactCount: 2,
            needsAttentionFactCount: 1,
          },
        ],
      },
    }),
  );

  assert.equal(model.assistants[0]?.id, "physician");
  assert.match(model.assistants[0]?.message ?? "", /2 значения/);
  assert.match(model.assistants[0]?.action.href ?? "", /^\/ivan\/docs\/.*0003$/);
});

/**
 * The record is deliberately larger than what the response shows: `recentObservations` is empty
 * and `recentDocuments` holds one entry, while the counts speak for 41 values and 12 documents.
 * A tile derived from either capped list would print the wrong number here.
 */
const wholeRecord = overview({
  documentCount: 12,
  confirmedCount: 41,
  outsideIndicatorCount: 3,
  withinIndicatorCount: 18,
  unknownIndicatorCount: 1,
  recentDocuments: [overviewDocument()],
});

test("the panel states the whole record, not the capped lists the response carries", () => {
  // Neither number can be reached from a list this response carries: one document, no observations.
  assert.equal(wholeRecord.recentObservations.length, 0);
  assert.equal(wholeRecord.recentDocuments.length, 1);
  const strip = signalsStrip(wholeRecord);
  assert.equal(strip.total, 22);
  assert.equal(strip.label, "22 показателя · 3 вне референса · 18 в пределах · 1 без референса");
  assert.deepEqual(
    signalChips(wholeRecord).map((chip) => chip.label),
    ["Ждёт проверки 0", "Документов 12 · последний 14 августа"],
  );
  const model = buildProfileDashboardModel(wholeRecord);
  assert.equal("score" in model, false);
  assert.equal("healthScore" in model, false);
  assert.equal("signals" in model, false);
});

test("a card that has answered says what its room said, not what the room can do", () => {
  const now = new Date(2026, 7, 20, 11, 0, 0);
  const model = buildProfileDashboardModel(
    overview({
      confirmedCount: 41,
      assistants: [
        {
          assistantId: "physician",
          answeredAt: new Date(2026, 7, 15, 9, 0, 0).toISOString(),
          urgency: "soon",
          refused: false,
        },
        {
          assistantId: "trainer",
          answeredAt: new Date(2026, 7, 19, 9, 0, 0).toISOString(),
          urgency: null,
          refused: true,
        },
      ],
    }),
    now,
  );

  assert.equal(
    model.assistants[0]?.message,
    "Последний ответ 5 дней назад · Запишитесь к врачу в ближайшие недели",
  );
  assert.equal(model.assistants[2]?.message, "Последний ответ не прошёл проверку");
  // The room that never answered keeps one sentence of what it is for, not the paragraph.
  assert.equal(
    model.assistants[1]?.message,
    "Оценю рацион по подтверждённым значениям и профилю: что усилить, что ограничить, что измерить снова — и что сверить с врачом.",
  );
  // A standing constraint is not self-description, so it stays under every card.
  assert.equal(
    model.assistants[1]?.meta,
    "Добавки — по названию, без доз; каждый пункт подтверждает диетолог или врач",
  );
});

test("nutrition and movement assistants stay honest when context is absent", () => {
  const model = buildProfileDashboardModel(overview());

  assert.equal(model.assistants[1]?.id, "nutrition");
  assert.match(model.assistants[1]?.message ?? "", /нечего оценивать/i);
  assert.match(model.assistants[1]?.action.href ?? "", /\/assistants\/nutritionist$/);
  assert.equal(model.assistants[2]?.id, "movement");
  assert.match(model.assistants[2]?.message ?? "", /ограничения/i);
  assert.match(model.assistants[2]?.action.href ?? "", /\/assistants\/trainer$/);
});
