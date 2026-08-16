import type {
  ProfileOverviewDocument,
  ProfileOverviewResponse,
  ProfileOverviewReviewDocument,
} from "@veylta/contracts";

export interface DocumentsArchiveHero {
  readonly sourceCount: number;
  readonly pendingDocumentCount: number;
  readonly pendingFactCount: number;
  readonly needsAttentionFactCount: number;
  readonly failedDocumentCount: number;
  /** Sources the archive-wide restart would act on: waiting or failed. */
  readonly restartableCount: number;
  /** Every value that may be confirmed without opening a source, across the whole queue. */
  readonly bulkConfirmableCount: number;
}

/**
 * A run that ended in a terminal failure. `retryAllowed` is the server's own judgement, so
 * the archive never offers a restart the API would refuse.
 */
export function isRestartable(document: ProfileOverviewDocument): boolean {
  const { processing } = document;
  if (processing.state === "failed") return processing.retryAllowed;
  return processing.state === "awaiting_review" || processing.state === "completed";
}

/**
 * Values with a validation warning always need an individual decision, so they are excluded
 * here exactly as they are inside the review workspace. Both surfaces must agree, or the
 * count shown next to a bulk action would promise more than the action performs.
 */
export function bulkConfirmableCount(document: ProfileOverviewReviewDocument): number {
  return Math.max(0, document.pendingFactCount - document.needsAttentionFactCount);
}

export function buildDocumentsArchiveHero(overview: ProfileOverviewResponse): DocumentsArchiveHero {
  const { reviewQueue, recentDocuments } = overview;
  return {
    sourceCount: recentDocuments.length,
    pendingDocumentCount: reviewQueue.documentCount,
    pendingFactCount: reviewQueue.pendingFactCount,
    needsAttentionFactCount: reviewQueue.needsAttentionFactCount,
    failedDocumentCount: recentDocuments.filter(
      (document) => document.processing.state === "failed",
    ).length,
    restartableCount: restartTargets(overview).length,
    bulkConfirmableCount: reviewQueue.documents.reduce(
      (total, document) => total + bulkConfirmableCount(document),
      0,
    ),
  };
}

const sourceForms = ["источник", "источника", "источников"] as const;
const valueForms = ["значение", "значения", "значений"] as const;
const documentForms = ["документ", "документа", "документов"] as const;

function pluralForm(count: number, forms: readonly [string, string, string] | readonly string[]) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export function sourceCountCopy(count: number): string {
  return `${count} ${pluralForm(count, sourceForms)}`;
}

export function archiveValueCountCopy(count: number): string {
  return `${count} ${pluralForm(count, valueForms)}`;
}

export function archiveDocumentCountCopy(count: number): string {
  return `${count} ${pluralForm(count, documentForms)}`;
}

export interface ArchiveRow {
  readonly document: ProfileOverviewDocument;
  /** Present while the source still has values awaiting a decision. */
  readonly queue: ProfileOverviewReviewDocument | null;
}

/**
 * One list for the archive: sources that still need a decision come first, everything else
 * follows, each group newest first as the API already orders them. A separate "queue" section
 * would only repeat rows the reader is about to scroll past.
 */
export function archiveRows(overview: ProfileOverviewResponse): readonly ArchiveRow[] {
  const queue = new Map(overview.reviewQueue.documents.map((entry) => [entry.id, entry]));
  const rows = overview.recentDocuments.map((document) => ({
    document,
    queue: queue.get(document.id) ?? null,
  }));
  return [...rows.filter((row) => row.queue !== null), ...rows.filter((row) => row.queue === null)];
}

/** What the archive-wide restart acts on: waiting or failed runs, never fully reviewed ones. */
export function restartTargets(
  overview: ProfileOverviewResponse,
): readonly ProfileOverviewDocument[] {
  return overview.recentDocuments.filter(
    (document) =>
      isRestartable(document) &&
      (document.processing.state === "awaiting_review" || document.processing.state === "failed"),
  );
}
