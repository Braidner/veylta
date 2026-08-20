/** The dossier's reading of one value against the source's own reference — API and web share it. */

export const POINT_STATUSES = ["above", "below", "within", "flagged", "unknown"] as const;
export type PointStatus = (typeof POINT_STATUSES)[number];

export interface PrintedRange {
  readonly sourceLow: string | null;
  readonly sourceHigh: string | null;
  readonly laboratoryOutOfRange: boolean | null;
}

/** «6,8» → 6.8; anything that is not one plain number («< 0,1», «отр.») → null. */
export function numberOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Printed bounds first, then the laboratory's flag, else unknown; a value without a number never compares. */
export function pointStatus(value: number | null, range: PrintedRange | null): PointStatus {
  if (range === null) return "unknown";
  const low = numberOf(range.sourceLow);
  const high = numberOf(range.sourceHigh);
  if (value !== null && (low !== null || high !== null)) {
    if (low !== null && value < low) return "below";
    if (high !== null && value > high) return "above";
    return "within";
  }
  if (range.laboratoryOutOfRange === true) return "flagged";
  if (range.laboratoryOutOfRange === false) return "within";
  return "unknown";
}

export const isOutsideRange = (status: PointStatus): boolean =>
  status === "above" || status === "below" || status === "flagged";

/** One indicator is one canonical code (or its printed name) under one printed unit. */
export function indicatorKey(
  canonicalCode: string | null,
  sourceName: string,
  sourceUnit: string,
): string {
  return `${canonicalCode ?? sourceName.toLocaleLowerCase("ru-RU")}|${sourceUnit}`;
}
