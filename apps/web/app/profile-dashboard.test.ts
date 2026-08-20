import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { buildProfileDashboardModel, signalHref } from "./profile-dashboard";

function overview(overrides: Partial<ProfileOverviewResponse> = {}): ProfileOverviewResponse {
  return {
    contractVersion: "profile-overview/v4",
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
  assert.equal(model.signals.pendingReview.value, "2");
  assert.equal(model.signals.pendingReview.tone, "attention");
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
  recentDocuments: [overviewDocument()],
});

test("the signals state the whole record, not the capped lists the response carries", () => {
  const model = buildProfileDashboardModel(wholeRecord);

  // Neither number can be reached from a list this response carries: one document, no observations.
  assert.equal(wholeRecord.recentObservations.length, 0);
  assert.equal(wholeRecord.recentDocuments.length, 1);
  assert.equal(model.signals.outside.value, "3");
  assert.equal(model.signals.outside.tone, "attention");
  assert.equal(
    model.signals.outside.detail,
    "Показатели, чьё последнее значение вне печатного диапазона",
  );
  assert.equal(model.signals.confirmed.value, "41");
  assert.equal(model.signals.confirmed.detail, "41 значение связано с источником");
  assert.equal(model.signals.confirmed.tone, "positive");
  assert.equal(model.signals.documents.value, "12");
  assert.equal(model.signals.documents.detail, "Последний — 14 августа 2026 г.");
  assert.equal(model.signals.documents.tone, "positive");
  assert.equal("score" in model, false);
  assert.equal("healthScore" in model, false);
});

test("an empty record says so on every tile and never turns attention on", () => {
  const model = buildProfileDashboardModel(overview());

  assert.equal(model.signals.outside.value, "0");
  assert.equal(model.signals.outside.tone, "positive");
  assert.equal(model.signals.outside.detail, "Все показатели в пределах диапазонов источников");
  assert.equal(model.signals.confirmed.detail, "Нет подтверждённых значений");
  assert.equal(model.signals.confirmed.tone, "neutral");
  assert.equal(model.signals.documents.detail, "Архив пока пуст");
  assert.equal(model.signals.documents.tone, "neutral");
});

test("only an outside tile above zero leads into the dossier", () => {
  assert.equal(signalHref("outside", wholeRecord), "/ivan/dossier");
  assert.equal(signalHref("outside", overview()), null);
  assert.equal(signalHref("confirmed", wholeRecord), null);
  assert.equal(signalHref("documents", wholeRecord), null);
  assert.equal(signalHref("pendingReview", wholeRecord), null);
});

test("nutrition and movement assistants stay honest when context is absent", () => {
  const model = buildProfileDashboardModel(overview());

  assert.equal(model.assistants[1]?.id, "nutrition");
  assert.match(model.assistants[1]?.message ?? "", /нечего оценивать/i);
  assert.match(model.assistants[1]?.action.href ?? "", /\/assistants\/nutritionist$/);
  assert.equal(model.assistants[2]?.id, "movement");
  assert.match(model.assistants[2]?.message ?? "", /ограничения/i);
  assert.match(model.assistants[2]?.action.href ?? "", /\/assistants\/trainer$/);
  assert.equal(model.signals.documents.value, "0");
  assert.equal(model.signals.confirmed.value, "0");
});
