import type { DossierSeries } from "./dossier";
import { defaultSelectionKey } from "./history-summary";

export interface HistorySelectionInput {
  /** What the reader chose on this page, or null while nothing has been chosen here. */
  readonly local: string | null;
  /** The `?code=` of the URL: what a link from the dossier or a document page asked to see. */
  readonly requestedCode: string | undefined;
  readonly series: readonly DossierSeries[];
}

/**
 * Which indicator the page shows: the reader's own choice while it still names a series, else the
 * first series of the requested code, else the record's default. A local choice whose series is
 * gone — a reload that returned less, a value withdrawn — is dropped rather than left dangling.
 */
export function chooseSelectionKey(input: HistorySelectionInput): string | null {
  const { local, requestedCode, series } = input;
  const chosen = series.find((entry) => entry.key === local);
  if (chosen !== undefined) return chosen.key;
  const byCode =
    requestedCode === undefined ? undefined : series.find((entry) => entry.code === requestedCode);
  return byCode?.key ?? defaultSelectionKey(series);
}
