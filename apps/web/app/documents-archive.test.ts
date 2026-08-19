import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProfileOverviewDocument,
  ProfileOverviewResponse,
  ProfileOverviewReviewDocument,
} from "@veylta/contracts";
import {
  archiveRows,
  archiveValueCountCopy,
  awaitingReviewVerb,
  buildDocumentsArchiveHero,
  bulkConfirmableCount,
  heroCountsCopy,
  isRestartable,
  restartTargets,
  sourceCountCopy,
  uploadButtonCopy,
} from "./documents-archive.js";

function reviewDocument(
  pendingFactCount: number,
  needsAttentionFactCount: number,
): ProfileOverviewReviewDocument {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    originalFilename: "synthetic.pdf",
    contentType: "application/pdf",
    uploadedAt: "2026-08-15T10:00:00.000Z",
    pendingFactCount,
    needsAttentionFactCount,
  };
}

function overviewDocument(
  processing: ProfileOverviewDocument["processing"],
): ProfileOverviewDocument {
  return {
    id: "00000000-0000-4000-8000-000000000002",
    originalFilename: "synthetic.pdf",
    contentType: "application/pdf",
    uploadedAt: "2026-08-15T10:00:00.000Z",
    effectiveDate: { value: "2026-08-15", source: "upload" },
    intelligence: null,
    processing,
  };
}

test("a bulk count never promises the values that need an individual decision", () => {
  assert.equal(bulkConfirmableCount(reviewDocument(40, 4)), 36);
  assert.equal(bulkConfirmableCount(reviewDocument(3, 3)), 0);
  // Defends against a projection that ever reports more warnings than pending values.
  assert.equal(bulkConfirmableCount(reviewDocument(2, 5)), 0);
});

test("restart is offered only where the server would accept it", () => {
  assert.equal(
    isRestartable(
      overviewDocument({
        state: "failed",
        updatedAt: "2026-08-15T10:00:00.000Z",
        category: "agent_output_invalid",
        retryAllowed: true,
      }),
    ),
    true,
  );
  assert.equal(
    isRestartable(
      overviewDocument({
        state: "failed",
        updatedAt: "2026-08-15T10:00:00.000Z",
        category: "attempts_exhausted",
        retryAllowed: false,
      }),
    ),
    false,
  );
  assert.equal(isRestartable(overviewDocument({ state: "not_started" })), false);
  assert.equal(
    isRestartable(overviewDocument({ state: "queued", updatedAt: "2026-08-15T10:00:00.000Z" })),
    false,
  );
  assert.equal(
    isRestartable(
      overviewDocument({
        state: "awaiting_review",
        updatedAt: "2026-08-15T10:00:00.000Z",
        factCount: 40,
        needsReviewCount: 4,
      }),
    ),
    true,
  );
});

test("the archive hero totals the whole queue, not the visible rows", () => {
  const overview = {
    documentCount: 2,
    reviewQueue: {
      documentCount: 7,
      pendingFactCount: 82,
      needsAttentionFactCount: 6,
      documents: [reviewDocument(40, 4), reviewDocument(42, 2)],
    },
    recentDocuments: [
      overviewDocument({
        state: "failed",
        updatedAt: "2026-08-15T10:00:00.000Z",
        category: "agent_output_invalid",
        retryAllowed: true,
      }),
      overviewDocument({ state: "queued", updatedAt: "2026-08-15T10:00:00.000Z" }),
    ],
  } as unknown as ProfileOverviewResponse;

  assert.deepEqual(buildDocumentsArchiveHero(overview, 5), {
    documentCount: 2,
    queueCount: 5,
    sourceCount: 2,
    pendingDocumentCount: 7,
    pendingFactCount: 82,
    needsAttentionFactCount: 6,
    failedDocumentCount: 1,
    restartableCount: 1,
    bulkConfirmableCount: 76,
  });
});

test("the hero line counts the record, the queue and the review", () => {
  assert.equal(
    heroCountsCopy({ documentCount: 12, queueCount: 3, pendingDocumentCount: 2 } as never),
    "12 всего · 3 в очереди · 2 ждут проверки",
  );
  assert.equal(
    heroCountsCopy({ documentCount: 1, queueCount: 0, pendingDocumentCount: 1 } as never),
    "1 всего · 0 в очереди · 1 ждёт проверки",
  );
});

test("Russian counts agree with their nouns", () => {
  assert.equal(sourceCountCopy(1), "1 источник");
  assert.equal(sourceCountCopy(3), "3 источника");
  assert.equal(sourceCountCopy(11), "11 источников");
  assert.equal(archiveValueCountCopy(21), "21 значение");
  assert.equal(archiveValueCountCopy(42), "42 значения");
  assert.equal(awaitingReviewVerb(1), "ждёт проверки");
  assert.equal(awaitingReviewVerb(2), "ждут проверки");
  assert.equal(awaitingReviewVerb(11), "ждут проверки");
  assert.equal(uploadButtonCopy(0), "Загрузить документы");
  assert.equal(uploadButtonCopy(1), "Загрузить 1 документ");
  assert.equal(uploadButtonCopy(3), "Загрузить 3 документа");
  assert.equal(uploadButtonCopy(20), "Загрузить 20 документов");
});

test("one list: sources awaiting a decision come first, each carrying its queue entry", () => {
  const waiting = {
    ...overviewDocument({
      state: "awaiting_review",
      updatedAt: "2026-08-15T10:00:00.000Z",
      factCount: 3,
      needsReviewCount: 1,
    }),
    id: "00000000-0000-4000-8000-00000000000a",
  };
  const done = {
    ...overviewDocument({
      state: "completed",
      updatedAt: "2026-08-15T09:00:00.000Z",
      factCount: 2,
    }),
    id: "00000000-0000-4000-8000-00000000000b",
  };
  const failed = {
    ...overviewDocument({
      state: "failed",
      updatedAt: "2026-08-15T08:00:00.000Z",
      category: "agent_output_invalid",
      retryAllowed: true,
    }),
    id: "00000000-0000-4000-8000-00000000000c",
  };
  const overview = {
    documentCount: 3,
    // Newest first, as the API returns them; the waiting one is deliberately not first here.
    recentDocuments: [done, waiting, failed],
    reviewQueue: {
      documentCount: 1,
      pendingFactCount: 3,
      needsAttentionFactCount: 1,
      documents: [{ ...reviewDocument(3, 1), id: waiting.id }],
    },
  } as unknown as ProfileOverviewResponse;

  const rows = archiveRows(overview);
  assert.deepEqual(
    rows.map((row) => [row.document.id, row.queue?.pendingFactCount ?? null]),
    [
      [waiting.id, 3],
      [done.id, null],
      [failed.id, null],
    ],
  );
  // The hero restart targets what is waiting or failed — never what is fully reviewed.
  assert.deepEqual(
    restartTargets(overview).map((document) => document.id),
    [waiting.id, failed.id],
  );
});
