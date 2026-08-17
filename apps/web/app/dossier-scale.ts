import type { SeriesPoint } from "./dossier";

export interface GaugeScale {
  /** The printed reference as a band on the track, in percent, left to right. */
  readonly band: { readonly from: number; readonly to: number };
  /** Where the latest value stands, in percent; null for a comparison reading («< 0,1»). */
  readonly marker: number | null;
  readonly lowLabel: string | null;
  readonly highLabel: string | null;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/**
 * One indicator on a horizontal track: the source's own bounds make the band, the value is a
 * marker; a value outside the reference stretches the track so nothing is clipped. Nothing here
 * grades the distance — the track only shows where the number stands against what was printed.
 */
export function gaugeScale(point: SeriesPoint): GaugeScale | null {
  const { low, high, value } = point;
  if (low === null && high === null) return null;
  const width = low !== null && high !== null ? high - low : Math.abs(low ?? high ?? 0);
  const span = width > 0 ? width : 1;
  let min = low !== null ? low - span / 2 : (high as number) - span * 1.5;
  let max = high !== null ? high + span / 2 : (low as number) + span * 1.5;
  if (value !== null) {
    if (value < min) min = value - span * 0.1;
    if (value > max) max = value + span * 0.1;
  }
  const at = (number: number) => clamp(((number - min) / (max - min)) * 100);
  return {
    band: { from: low === null ? 0 : at(low), to: high === null ? 100 : at(high) },
    marker: value === null ? null : at(value),
    lowLabel: point.lowText,
    highLabel: point.highText,
  };
}
