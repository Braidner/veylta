import { normalizeAnalyteName } from "../analyte-mapping.js";
import type { AnalyteCatalogEntry } from "../document-intelligence-provider.js";
import { keyPattern } from "./constants.js";
import { invalidOutput } from "./errors.js";

/**
 * Names a model may put where the analyte name belongs and that never are one: the header of
 * a name column, a page label, the fact's own key. Everything else is checked against the row.
 */
const headerNames = new Set([
  "анализ",
  "показатель",
  "название/показатель",
  "исследование",
  "результат",
  "наименование",
  "параметр",
  "тест",
  "концентрация",
  "активность",
  "расчет",
  "значение",
  "измерение",
  "lab",
  "laboratory",
  "laboratory_result",
  "result",
  "analyte",
  "test",
]);

function isPlaceholder(name: string): boolean {
  const key = normalizeAnalyteName(name);
  return headerNames.has(key) || /^page\s*\d+$/.test(key) || keyPattern.test(name);
}

/**
 * The row's own spelling of a normalized name key, or null when the row does not print it.
 * Folding is length-preserving for the scripts a laboratory prints, so the span found in the
 * folded row is the span in the printed one; a fold that changed length is not trusted.
 */
function printedSpan(fragment: string, key: string): string | null {
  const compact = fragment.normalize("NFKC").trim().replace(/\s+/g, " ");
  const folded = compact.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
  if (folded.length !== compact.length || key.length < 2) return null;
  const index = folded.indexOf(key);
  return index < 0 ? null : compact.slice(index, index + key.length);
}

/**
 * The analyte name as the source prints it for the value: in the value's own row, or in the
 * few lines above it where a laboratory sets the name as a heading over the row. The model's
 * name is kept when it is printed there (in the source's own casing); a header, row label,
 * page label or key is not a name, and is replaced by the household catalog's spelling of the
 * proposed code when that spelling is printed there — a deterministic recovery, never a guess.
 * A name that is neither printed nor recoverable is inconsistent with its source and drops
 * the fact.
 */
export function printedName(
  proposed: string,
  source: { readonly fragment: string; readonly context: string; readonly heading: string },
  proposedCode: string | null,
  catalog: readonly AnalyteCatalogEntry[],
): string {
  if (!isPlaceholder(proposed)) {
    const key = normalizeAnalyteName(proposed);
    const printed = printedSpan(source.fragment, key) ?? printedSpan(source.context, key);
    if (printed !== null) return printed;
  }
  // Recovery reads the row and its heading only: a spelling printed below the value could be
  // the next row's, and a recovered name must never be a neighbour's.
  const entry = proposedCode === null ? null : catalog.find((item) => item.code === proposedCode);
  if (entry !== null && entry !== undefined) {
    const spellings = [
      ...new Set([...entry.aliases, entry.displayName].map(normalizeAnalyteName)),
    ].sort((a, b) => b.length - a.length);
    for (const spelling of spellings) {
      const printed =
        printedSpan(source.fragment, spelling) ?? printedSpan(source.heading, spelling);
      if (printed !== null) return printed;
    }
  }
  invalidOutput("inconsistent_fields");
}
