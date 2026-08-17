/** «5.0–8.0 synthetic-unit» → the printed bounds; any other reference text stays text only. */
const printedBoundsPattern = /^(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)(?:\s+\S.*)?$/;

export function printedBounds(referenceText: string): {
  readonly sourceLow: string | null;
  readonly sourceHigh: string | null;
} {
  const match = printedBoundsPattern.exec(referenceText.trim());
  return match === null
    ? { sourceLow: null, sourceHigh: null }
    : { sourceLow: match[1] ?? null, sourceHigh: match[2] ?? null };
}
