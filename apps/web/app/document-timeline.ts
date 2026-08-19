import type {
  DocumentCategory,
  DocumentEffectiveDate,
  DocumentSummary,
  DocumentTimelineEntry,
  SyntheticDocumentContentType,
} from "@veylta/contracts";
import { formatSampleMoment } from "./format-moment";

/** One node of the timeline — a reviewed document, or a search hit shown the same way. */
export interface TimelineNode {
  readonly id: string;
  readonly title: string;
  readonly filename: string;
  readonly contentType: SyntheticDocumentContentType;
  readonly category: DocumentCategory | null;
  readonly shortSummary: string | null;
  readonly effectiveDate: DocumentEffectiveDate;
  readonly counts: readonly string[];
}

export interface TimelineGroup {
  /** `YYYY-MM` */
  readonly key: string;
  /** «Август 2026» */
  readonly label: string;
  /** The year, on the first group and wherever the year changes; else null. */
  readonly yearMarker: string | null;
  readonly nodes: readonly TimelineNode[];
}

/** Moved from `veylta-app.tsx` `documentCategoryLabels`. */
export const documentCategoryLabels: Record<DocumentCategory, string> = {
  laboratory: "Анализы",
  imaging: "Снимки и исследования",
  prescription: "Назначения",
  discharge_summary: "Выписки",
  consultation: "Консультации",
  vaccination: "Вакцинация",
  insurance: "Страховые документы",
  other: "Другое",
};

const monthNames = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "UTC" });

/** «2026-08» → «Август 2026». */
export function monthLabel(key: string): string {
  const month = monthNames.format(new Date(`${key}-01T00:00:00.000Z`));
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${key.slice(0, 4)}`;
}

/** Chips only when they say something: confirmed values, those outside the range, the clinician's records. */
export function nodeCounts(entry: DocumentTimelineEntry): readonly string[] {
  const chips: string[] = [];
  if (entry.confirmedCount > 0) chips.push(`подтверждено ${entry.confirmedCount}`);
  if (entry.outsideRangeCount > 0) chips.push(`вне референса: ${entry.outsideRangeCount}`);
  if (entry.recordCount > 0) chips.push(`записи врача: ${entry.recordCount}`);
  return chips;
}

export function timelineNodes(entries: readonly DocumentTimelineEntry[]): readonly TimelineNode[] {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title ?? entry.originalFilename,
    filename: entry.originalFilename,
    contentType: entry.contentType,
    category: entry.category,
    shortSummary: entry.shortSummary,
    effectiveDate: entry.effectiveDate,
    counts: nodeCounts(entry),
  }));
}

/** Search hits are summaries without counts; they render as nodes too. */
export function searchNodes(documents: readonly DocumentSummary[]): readonly TimelineNode[] {
  return documents.map((document) => ({
    id: document.id,
    title: document.intelligence?.title ?? document.originalFilename,
    filename: document.originalFilename,
    contentType: document.contentType,
    category: document.intelligence?.category ?? null,
    shortSummary: document.intelligence?.shortSummary ?? null,
    effectiveDate: document.effectiveDate,
    counts: [],
  }));
}

/** Nodes are newest first already; group by month and mark the first month of each year. */
export function timelineGroups(nodes: readonly TimelineNode[]): readonly TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  let previousYear: string | null = null;
  for (const node of nodes) {
    const key = node.effectiveDate.value.slice(0, 7);
    const year = key.slice(0, 4);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) {
      groups[groups.length - 1] = { ...last, nodes: [...last.nodes, node] };
      continue;
    }
    groups.push({
      key,
      label: monthLabel(key),
      yearMarker: year === previousYear ? null : year,
      nodes: [node],
    });
    previousYear = year;
  }
  return groups;
}

const sourceMarker: Record<DocumentEffectiveDate["source"], string | null> = {
  document: null,
  upload: "по дате загрузки",
  person: "дата исправлена",
};

/** The day in words and, when the date is not the document's own, where it came from. */
export function effectiveDateCopy(date: DocumentEffectiveDate): {
  readonly date: string;
  readonly marker: string | null;
} {
  return { date: formatSampleMoment(date.value), marker: sourceMarker[date.source] };
}

/** A further page appended without repeating a document already shown. */
export function mergeTimelinePages(
  loaded: readonly DocumentTimelineEntry[],
  next: readonly DocumentTimelineEntry[],
): readonly DocumentTimelineEntry[] {
  const seen = new Set(loaded.map((entry) => entry.id));
  return [...loaded, ...next.filter((entry) => !seen.has(entry.id))];
}
