import { isOutsideRange } from "@veylta/contracts";
import type { DossierSeries, SeriesPoint } from "./dossier";

/** The summary's window: three calendar months, six, a year, or the whole record. */
export const HISTORY_PERIODS = ["3m", "6m", "12m", "all"] as const;
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number];

export const historyPeriodLabel: Record<HistoryPeriod, string> = {
  "3m": "3 мес",
  "6m": "6 мес",
  "12m": "Год",
  all: "Всё",
};

const periodMonths: Record<Exclude<HistoryPeriod, "all">, number> = { "3m": 3, "6m": 6, "12m": 12 };

/** The period's left edge as an ISO instant (UTC month arithmetic), or null for the whole record. */
export function periodStart(period: HistoryPeriod, now: Date): string | null {
  if (period === "all") return null;
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - periodMonths[period]);
  return start.toISOString();
}

export const HISTORY_BUCKETS = [
  "moved_outside",
  "returned_inside",
  "unchanged",
  "first_measured",
] as const;
export type HistoryBucketKind = (typeof HISTORY_BUCKETS)[number];

export const historyBucketLabel: Record<HistoryBucketKind, string> = {
  moved_outside: "Вышли за референс",
  returned_inside: "Вернулись в референс",
  unchanged: "Без изменений",
  first_measured: "Впервые измерены",
};

export interface HistorySummaryBucket {
  readonly kind: HistoryBucketKind;
  readonly series: readonly DossierSeries[];
}

export interface HistorySummary {
  readonly buckets: readonly HistorySummaryBucket[];
  /** Series with at least one point in the period — the summary's denominator. */
  readonly measuredCount: number;
}

/**
 * What changed over the period, by the dossier's status rule and nothing else. The baseline is
 * the last value before the period (or the first inside it); a series measured once and never
 * before is «впервые измерено»; a series with no point in the period is not counted.
 */
export function historySummary(
  series: readonly DossierSeries[],
  period: HistoryPeriod,
  now: Date,
): HistorySummary {
  const start = periodStart(period, now);
  const buckets = new Map<HistoryBucketKind, DossierSeries[]>(
    HISTORY_BUCKETS.map((kind) => [kind, []]),
  );
  let measured = 0;
  for (const entry of series) {
    const inPeriod =
      start === null ? entry.points : entry.points.filter((point) => point.at >= start);
    const first = inPeriod[0];
    if (first === undefined) continue;
    measured += 1;
    const before: SeriesPoint | undefined =
      start === null ? undefined : [...entry.points].reverse().find((point) => point.at < start);
    const baseline = before ?? first;
    const latest = inPeriod[inPeriod.length - 1] ?? first;
    if (baseline === latest) {
      buckets.get("first_measured")?.push(entry);
      continue;
    }
    const wasOutside = isOutsideRange(baseline.status);
    const isOutside = isOutsideRange(latest.status);
    const kind: HistoryBucketKind =
      isOutside && !wasOutside
        ? "moved_outside"
        : !isOutside && wasOutside
          ? "returned_inside"
          : "unchanged";
    buckets.get(kind)?.push(entry);
  }
  return {
    buckets: HISTORY_BUCKETS.map((kind) => ({ kind, series: buckets.get(kind) ?? [] })),
    measuredCount: measured,
  };
}

/** With no `?code=`: the first indicator currently outside its reference, else the first at all. */
export function defaultSelectionKey(series: readonly DossierSeries[]): string | null {
  const outside = series.find((entry) => isOutsideRange(entry.status));
  return (outside ?? series[0])?.key ?? null;
}
