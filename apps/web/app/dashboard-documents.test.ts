import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { documentKindLine, documentStandingCopy } from "./dashboard-documents";

type OverviewDocument = ProfileOverviewResponse["recentDocuments"][number];

function overviewDocument(overrides: Partial<OverviewDocument> = {}): OverviewDocument {
  return {
    id: "00000000-0000-4000-8000-000000000030",
    // What these documents actually carry: a derived id, not a name a person ever typed.
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

test("a document row names its kind and the day it speaks about", () => {
  assert.equal(documentKindLine(overviewDocument()), "Анализы · 14 августа 2026 г.");
  assert.equal(
    documentKindLine(overviewDocument({ intelligence: null })),
    "Документ · 14 августа 2026 г.",
  );
  // The effective date, not the upload day — those differ here by two days.
  assert.equal(
    documentKindLine(
      overviewDocument({ effectiveDate: { value: "2026-07-01", source: "upload" } }),
    ),
    "Анализы · 1 июля 2026 г.",
  );
});

test("a document row states what waits for the person before what processing did", () => {
  const document = overviewDocument();
  const waiting = (pendingFactCount: number) => [
    {
      id: document.id,
      originalFilename: document.originalFilename,
      contentType: document.contentType,
      uploadedAt: document.uploadedAt,
      pendingFactCount,
      needsAttentionFactCount: 1,
    },
  ];

  assert.equal(documentStandingCopy(document, waiting(2)), "2 ждут проверки");
  assert.equal(documentStandingCopy(document, waiting(1)), "1 ждёт проверки");
  // factCount is every fact the run extracted, rejections included — hence «разобрано».
  assert.equal(documentStandingCopy(document, []), "разобрано 6");
  assert.equal(
    documentStandingCopy(overviewDocument({ processing: { state: "not_started" } }), []),
    "Ожидает обработки",
  );
  assert.equal(
    documentStandingCopy(
      overviewDocument({
        processing: {
          state: "failed",
          updatedAt: "2026-08-16T10:00:00.000Z",
          category: "extraction_failed",
          retryAllowed: true,
        },
      }),
      [],
    ),
    "Не обработан",
  );
});
