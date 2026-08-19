import {
  type DocumentProcessingStatus,
  isInDocumentQueue,
  type ProfileOverviewDocument,
  type ProfileOverviewResponse,
  type ProfileOverviewReviewDocument,
} from "@veylta/contracts";
import { archiveRows, archiveValueCountCopy, isRestartable } from "./documents-archive";

/** One document that still needs the machine or the person. */
export interface QueueRow {
  readonly document: ProfileOverviewDocument;
  readonly review: ProfileOverviewReviewDocument | null;
}

export type QueueAction = { kind: "review"; count: number } | { kind: "retry" } | { kind: "none" };

/** The queue: awaiting review first, then the rest in upload order — `archiveRows` keeps that order. */
export function queueRows(overview: ProfileOverviewResponse): readonly QueueRow[] {
  return archiveRows(overview)
    .filter((row) => isInDocumentQueue(row.document.processing, row.queue?.pendingFactCount ?? 0))
    .map((row) => ({ document: row.document, review: row.queue }));
}

/** «всего · в очереди · ждут проверки» for the hero line. */
export function queueCounts(overview: ProfileOverviewResponse): {
  readonly total: number;
  readonly inQueue: number;
  readonly awaitingReview: number;
} {
  return {
    total: overview.documentCount,
    inQueue: queueRows(overview).length,
    awaitingReview: overview.reviewQueue.documentCount,
  };
}

/** What the row offers: check the pending values, retry a failure, or nothing while the machine works. */
export function queueAction(row: QueueRow): QueueAction {
  const pending = row.review?.pendingFactCount ?? 0;
  if (row.document.processing.state === "awaiting_review" && pending > 0) {
    return { kind: "review", count: pending };
  }
  if (row.document.processing.state === "failed" && isRestartable(row.document))
    return { kind: "retry" };
  return { kind: "none" };
}

/** The state in the person's words — moved from `veylta-app.tsx`'s `profileOverviewProcessingCopy`. */
export function queueStateCopy(status: DocumentProcessingStatus): string {
  switch (status.state) {
    case "not_started":
      return "Обработка ещё не началась";
    case "queued":
      return "В очереди обработки";
    case "security_check":
      return "Проверяем исходник";
    case "text_extraction":
      return "Извлекаем текст";
    case "document_classification":
      return "Codex определяет раздел";
    case "structured_extraction":
      return "Готовим черновые значения";
    case "validation":
      return "Проверяем черновой результат";
    case "awaiting_review":
      return `${archiveValueCountCopy(status.factCount)} ждут явной проверки`;
    case "completed":
      return `${archiveValueCountCopy(status.factCount)} подтверждены пользователем`;
    case "failed":
      return "Обработка не завершилась";
  }
}
