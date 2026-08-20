import type { ProfileOverviewResponse } from "@veylta/contracts";
import { formatSampleDay } from "./format-moment";
import { profileTabPath } from "./paths";
import { countCopy } from "./russian-plural";

/** The three states the record puts an indicator in; together they are the whole record. */
export type SignalSegmentKey = "outside" | "within" | "unknown";

export interface SignalSegment {
  readonly key: SignalSegmentKey;
  readonly count: number;
  /** «3 вне референса» — the number and the word, so colour never carries the meaning alone. */
  readonly label: string;
  /** Only «вне референса» has a page of its own; the other two are stated, not opened. */
  readonly href: string | null;
}

export interface SignalsStrip {
  /** Every distinct indicator the record holds — the three counts add up to it. */
  readonly total: number;
  /** In the record's fixed order, sized by their counts; a count of zero has no segment. */
  readonly segments: readonly SignalSegment[];
  /** The bar read aloud, or the line that stands in its place while nothing is confirmed. */
  readonly label: string;
}

export const EMPTY_RECORD_COPY =
  "Пока нет подтверждённых значений — они появятся после проверки документа";

const segmentOrder = ["outside", "within", "unknown"] as const;

const segmentWord: Record<SignalSegmentKey, string> = {
  outside: "вне референса",
  within: "в пределах",
  unknown: "без референса",
};

/**
 * The record as three counted states — outside, within, and what it cannot place at all. Never a
 * score: each segment is a number of indicators and the word for where they stand, and «нечего
 * сравнить» stays its own state rather than joining «в пределах».
 */
export function signalsStrip(overview: ProfileOverviewResponse): SignalsStrip {
  const counts: Record<SignalSegmentKey, number> = {
    outside: overview.outsideIndicatorCount,
    within: overview.withinIndicatorCount,
    unknown: overview.unknownIndicatorCount,
  };
  const total = counts.outside + counts.within + counts.unknown;
  const segments: SignalSegment[] = segmentOrder
    .filter((key) => counts[key] > 0)
    .map((key) => ({
      key,
      count: counts[key],
      label: `${counts[key]} ${segmentWord[key]}`,
      href: key === "outside" ? profileTabPath(overview.profile.handle, "dossier") : null,
    }));
  const named = segments.map((segment) => segment.label).join(" · ");
  return {
    total,
    segments,
    label:
      total === 0
        ? EMPTY_RECORD_COPY
        : `${countCopy(total, ["показатель", "показателя", "показателей"])} · ${named}`,
  };
}

export interface SignalChip {
  readonly key: "review" | "documents";
  readonly label: string;
  /** Where the chip leads; bookkeeping that cannot be acted on stays plain text. */
  readonly href: string | null;
}

/**
 * What the record holds as bookkeeping, under the picture rather than beside it: how much still
 * waits for a decision, and how large the archive is. Only the waiting is something to do.
 */
export function signalChips(overview: ProfileOverviewResponse): readonly SignalChip[] {
  const pending = overview.reviewQueue.pendingFactCount;
  const newest = overview.recentDocuments[0];
  const day =
    newest === undefined ? "" : ` · последний ${formatSampleDay(newest.effectiveDate.value)}`;
  return [
    {
      key: "review",
      label: `Ждёт проверки ${pending}`,
      href: pending > 0 ? profileTabPath(overview.profile.handle, "documents") : null,
    },
    { key: "documents", label: `Документов ${overview.documentCount}${day}`, href: null },
  ];
}
