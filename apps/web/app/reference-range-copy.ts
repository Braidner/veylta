/**
 * One printed reference for every surface: the source's own text when it printed one, else the
 * printed bounds as «low–high unit», else «Не указан». Review, history and the dossier agree.
 */
export function referenceRangeCopy(range: {
  readonly sourceText: string | null;
  readonly sourceLow: string | null;
  readonly sourceHigh: string | null;
  readonly sourceUnit: string | null;
}): string {
  if (range.sourceText !== null) return range.sourceText;
  if (range.sourceLow === null && range.sourceHigh === null) return "Не указан";
  const bounds = `${range.sourceLow ?? "…"}–${range.sourceHigh ?? "…"}`;
  return range.sourceUnit === null ? bounds : `${bounds} ${range.sourceUnit}`;
}
