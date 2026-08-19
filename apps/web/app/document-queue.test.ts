import assert from "node:assert/strict";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { queueAction, queueCounts, queueRows, queueStateCopy } from "./document-queue";

const at = "2026-08-10T08:00:00.000Z";
const document = (
  id: string,
  processing: ProfileOverviewResponse["recentDocuments"][number]["processing"],
): ProfileOverviewResponse["recentDocuments"][number] => ({
  id,
  originalFilename: `${id}.pdf`,
  contentType: "application/pdf",
  uploadedAt: at,
  effectiveDate: { value: "2026-08-10", source: "upload" },
  intelligence: null,
  processing,
});

const overview = {
  contractVersion: "profile-overview/v3",
  profile: {
    id: "p",
    familyId: "f",
    displayName: "Анна",
    kind: "adult",
    access: "owner",
    handle: "anna",
    createdAt: at,
  },
  documentCount: 7,
  recentDocuments: [
    document("done", { state: "completed", updatedAt: at, factCount: 2 }),
    document("review", {
      state: "awaiting_review",
      updatedAt: at,
      factCount: 2,
      needsReviewCount: 1,
    }),
    document("running", { state: "text_extraction", updatedAt: at }),
    document("failed", {
      state: "failed",
      updatedAt: at,
      category: "extraction_failed",
      retryAllowed: true,
    }),
    document("fresh", { state: "not_started" }),
  ],
  reviewQueue: {
    documentCount: 1,
    pendingFactCount: 2,
    needsAttentionFactCount: 1,
    documents: [
      {
        id: "review",
        originalFilename: "review.pdf",
        contentType: "application/pdf",
        uploadedAt: at,
        pendingFactCount: 2,
        needsAttentionFactCount: 1,
      },
    ],
  },
  recentObservations: [],
} as unknown as ProfileOverviewResponse;

test("the queue holds what is not done: the one awaiting review first, then the rest in upload order", () => {
  assert.deepEqual(
    queueRows(overview).map((row) => row.document.id),
    ["review", "running", "failed", "fresh"],
  );
  assert.deepEqual(queueCounts(overview), { total: 7, inQueue: 4, awaitingReview: 1 });
});

test("each row knows its one action and its state in words", () => {
  const rows = queueRows(overview);
  assert.deepEqual(queueAction(rows[0]!), { kind: "review", count: 2 });
  assert.deepEqual(queueAction(rows[1]!), { kind: "none" });
  assert.deepEqual(queueAction(rows[2]!), { kind: "retry" });
  assert.deepEqual(queueAction(rows[3]!), { kind: "none" });
  assert.equal(queueStateCopy(rows[1]!.document.processing), "Извлекаем текст");
  assert.equal(queueStateCopy(rows[2]!.document.processing), "Обработка не завершилась");
  assert.equal(queueStateCopy(rows[0]!.document.processing), "2 значения ждут явной проверки");
});
