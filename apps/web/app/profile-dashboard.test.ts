import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { buildProfileDashboardModel } from "./profile-dashboard";

function overview(overrides: Partial<ProfileOverviewResponse> = {}): ProfileOverviewResponse {
  return {
    contractVersion: "profile-overview/v2",
    profile: {
      id: "00000000-0000-4000-8000-000000000002",
      familyId: "00000000-0000-4000-8000-000000000001",
      displayName: "Иван",
      kind: "adult",
      access: "owner",
      createdAt: "2026-08-01T09:00:00.000Z",
    },
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
  assert.match(model.assistants[0]?.action.href ?? "", /documents\/.*0003$/);
  assert.equal(model.signals.pendingReview.value, "2");
  assert.equal(model.signals.pendingReview.tone, "attention");
});

test("health signals count only explicit source flags and never invent a score", () => {
  const baseObservation = {
    id: "00000000-0000-4000-8000-000000000010",
    canonicalCode: null,
    source: { name: "Глюкоза", value: "7.0", unit: "ммоль/л" },
    normalized: { value: null, unit: null, conversionVersion: null },
    dates: { sampledAt: null, resultedAt: null, uploadedAt: "2026-08-12T09:00:00.000Z" },
    timelineAt: "2026-08-12T09:00:00.000Z",
    specimenType: null,
    laboratory: "Синтетическая лаборатория",
    extractionConfidence: 0.98,
    confirmed: {
      at: "2026-08-12T10:00:00.000Z",
      by: { id: "00000000-0000-4000-8000-000000000011", displayName: "Иван" },
    },
    sourceDocument: {
      id: "00000000-0000-4000-8000-000000000012",
      versionId: "00000000-0000-4000-8000-000000000013",
      pageNumber: 1,
      fragment: "SYNTHETIC TEST DATA",
      contentPath: "/source",
    },
  } as const;
  const model = buildProfileDashboardModel(
    overview({
      recentObservations: [
        {
          ...baseObservation,
          referenceRange: {
            sourceText: "3.9–6.1",
            sourceLow: "3.9",
            sourceHigh: "6.1",
            sourceUnit: "ммоль/л",
            laboratoryOutOfRange: true,
            normalizedLow: null,
            normalizedHigh: null,
            normalizedUnit: null,
            conversionVersion: null,
          },
        },
        {
          ...baseObservation,
          id: "00000000-0000-4000-8000-000000000020",
          referenceRange: null,
        },
      ],
    }),
  );

  assert.equal(model.signals.sourceFlags.value, "1");
  assert.match(model.signals.sourceFlags.detail, /диапазона источника/);
  assert.equal("score" in model, false);
  assert.equal("healthScore" in model, false);
});

test("nutrition and movement assistants stay honest when context is absent", () => {
  const model = buildProfileDashboardModel(overview());

  assert.equal(model.assistants[1]?.id, "nutrition");
  assert.match(model.assistants[1]?.message ?? "", /недостаточно данных/i);
  assert.match(model.assistants[1]?.action.href ?? "", /\?tab=plan$/);
  assert.equal(model.assistants[2]?.id, "movement");
  assert.match(model.assistants[2]?.message ?? "", /ограничения/i);
  assert.equal(model.signals.sources.value, "0");
  assert.equal(model.signals.confirmed.value, "0");
});
