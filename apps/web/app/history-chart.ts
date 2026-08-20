import type { PointStatus } from "@veylta/contracts";
import type { DossierSeries, SeriesPoint } from "./dossier";
import { formatSampleMoment } from "./format-moment";
import { type HistoryPeriod, periodStart } from "./history-summary";

export interface ChartPoint {
  readonly x: number;
  readonly y: number;
  readonly status: PointStatus;
  readonly observationId: string;
  readonly documentId: string;
  readonly printed: string;
  readonly at: string;
  readonly laboratory: string | null;
  readonly rangeText: string | null;
}

/** One run of identical printed bounds; the band steps at the first point that prints new ones. */
export interface BandSegment {
  /** The value whose bounds opened this run — the segment's identity, unique even at one moment. */
  readonly since: string;
  readonly x1: number;
  readonly x2: number;
  readonly yTop: number;
  readonly yBottom: number;
}

export interface AxisTick {
  readonly x: number;
  readonly label: string;
}

export interface HistoryChartModel {
  readonly points: readonly ChartPoint[];
  readonly band: readonly BandSegment[];
  readonly ticks: readonly AxisTick[];
  readonly yMinLabel: string;
  readonly yMaxLabel: string;
  readonly empty: "no_numeric" | null;
}

const PAD = 8; // percent of headroom above and below the data
const yLabel = new Intl.NumberFormat("ru-RU");

/** A point with a value plotted on the chart never lacks a number — only its bounds may be missing. */
type NumericPoint = SeriesPoint & { readonly value: number };

/**
 * The chart as numbers only: x is the period's time axis, y is the value axis inverted for SVG,
 * both in percent of the drawing box. The reference band is stepped — each point's own printed
 * bounds hold until the next point prints different ones; a missing bound clamps to the edge.
 */
export function historyChartModel(
  series: DossierSeries,
  period: HistoryPeriod,
  now: Date,
): HistoryChartModel {
  const start = periodStart(period, now);
  const visible = series.points.filter(
    (point): point is NumericPoint => point.value !== null && (start === null || point.at >= start),
  );
  if (visible.length === 0) {
    return { points: [], band: [], ticks: [], yMinLabel: "", yMaxLabel: "", empty: "no_numeric" };
  }

  const left =
    start === null
      ? new Date(visible[0]?.at ?? now.toISOString()).getTime()
      : new Date(start).getTime();
  const right = now.getTime();
  const spanX = Math.max(right - left, 1);
  const xOf = (at: string) => ((new Date(at).getTime() - left) / spanX) * 100;

  const bounds = visible
    .flatMap((point) => [point.low, point.high])
    .filter((bound): bound is number => bound !== null);
  const domain = [...visible.map((point) => point.value), ...bounds];
  const min = Math.min(...domain);
  const max = Math.max(...domain);
  const spanY = max - min || 1;
  const yOf = (value: number) => 100 - (((value - min) / spanY) * (100 - PAD * 2) + PAD);

  const points: ChartPoint[] = visible.map((point) => ({
    x: xOf(point.at),
    y: yOf(point.value),
    status: point.status,
    observationId: point.observationId,
    documentId: point.documentId,
    printed: point.printed,
    at: point.at,
    laboratory: point.laboratory,
    rangeText: point.rangeText,
  }));

  const band: BandSegment[] = [];
  visible.forEach((point, index) => {
    if (point.low === null && point.high === null) return;
    // The earliest visible point's bounds are the earliest ones known, so they hold back to the
    // period's left edge: a bounded window must not open with an unshaded gap before the value.
    const x1 = index === 0 ? 0 : (points[index]?.x ?? 0);
    const x2 = points[index + 1]?.x ?? 100;
    const yTop = point.high === null ? 0 : yOf(point.high);
    const yBottom = point.low === null ? 100 : yOf(point.low);
    const previous = band[band.length - 1];
    if (previous !== undefined && previous.yTop === yTop && previous.yBottom === yBottom) {
      band[band.length - 1] = { ...previous, x2 };
    } else {
      band.push({ since: point.observationId, x1, x2, yTop, yBottom });
    }
  });

  const tickCount = Math.min(4, Math.max(2, points.length));
  const ticks: AxisTick[] = Array.from({ length: tickCount }, (_, index) => {
    const ratio = index / (tickCount - 1);
    const at = new Date(left + ratio * spanX).toISOString();
    return { x: ratio * 100, label: formatSampleMoment(at.slice(0, 10)) };
  });

  return {
    points,
    band,
    ticks,
    yMinLabel: yLabel.format(min),
    yMaxLabel: yLabel.format(max),
    empty: null,
  };
}
