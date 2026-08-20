/** How one source reads in the overview's «Последние документы» block. */
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { documentCategoryLabels } from "./document-timeline";
import { formatSampleMoment } from "./format-moment";
import { pluralForm } from "./russian-plural";

type OverviewDocument = ProfileOverviewResponse["recentDocuments"][number];
type ReviewDocuments = ProfileOverviewResponse["reviewQueue"]["documents"];

/** Moved from the component: where processing stands, when nothing waits for the person. */
export function documentStateCopy(state: OverviewDocument["processing"]["state"]): string {
  switch (state) {
    case "completed":
      return "Проверено";
    case "awaiting_review":
      return "Нужна проверка";
    case "failed":
      return "Не обработан";
    case "not_started":
    case "queued":
      return "Ожидает обработки";
    default:
      return "Обработка";
  }
}

/**
 * «Анализы · 14 августа 2026 г.» — what the document is and the day it speaks about. The stored
 * filename is a derived id and says nothing to the reader, so the row never leads with it.
 */
export function documentKindLine(document: OverviewDocument): string {
  const category = document.intelligence?.category ?? null;
  const kind = category === null ? "Документ" : documentCategoryLabels[category];
  return `${kind} · ${formatSampleMoment(document.effectiveDate.value)}`;
}

/**
 * A document's own state as the person meets it: what still waits for their decision comes first,
 * because that is the only thing they can act on; a finished document says how much it held.
 *
 * «разобрано», not «подтверждено»: `processing.factCount` is every fact the run extracted, and a
 * rejected fact is counted there too — the overview carries no per-document count of what became
 * an observation, and printing this number as confirmed values would overstate the record.
 */
export function documentStandingCopy(
  document: OverviewDocument,
  reviewQueue: ReviewDocuments,
): string {
  const waiting = reviewQueue.find((entry) => entry.id === document.id);
  if (waiting !== undefined) {
    const forms = ["ждёт проверки", "ждут проверки", "ждут проверки"] as const;
    return `${waiting.pendingFactCount} ${pluralForm(waiting.pendingFactCount, forms)}`;
  }
  const { processing } = document;
  if (processing.state === "completed") return `разобрано ${processing.factCount}`;
  return documentStateCopy(processing.state);
}
