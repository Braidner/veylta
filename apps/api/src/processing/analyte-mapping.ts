import type { DatabaseClient } from "../database/pool.js";
import type { AnalyteCatalogEntry } from "./document-intelligence-provider.js";
import type { StrictLabExtractionFact } from "./synthetic-lab-parser.js";

interface AnalyteMappingRow {
  canonical_code: string;
  canonical_unit: string;
  display_name: string;
  source_name_key: string;
  source_unit_key: string;
}

export interface AnalyteMappingInput {
  readonly sourceName: string;
  readonly sourceUnit: string;
  readonly sourceValue: string;
  readonly proposedLaboratory: string | null;
}

export interface ResolvedAnalyteMapping {
  readonly canonicalCode: string;
  readonly displayName: string;
  readonly normalizedUnit: string | null;
  readonly normalizedValue: string | null;
}

function compact(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeAnalyteName(value: string): string {
  return compact(value).toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}

/**
 * Russian unit atoms and their Latin spellings, applied longest first so that "ммоль" is read
 * before "мм" and "мед" before "ме". This is transliteration of a printed spelling, never a
 * conversion: every pair names the same unit at the same magnitude.
 */
const cyrillicUnitAtoms: ReadonlyArray<readonly [string, string]> = (
  [
    ["мкмоль", "umol"],
    ["ммоль", "mmol"],
    ["нмоль", "nmol"],
    ["пмоль", "pmol"],
    ["фмоль", "fmol"],
    ["моль", "mol"],
    ["мкме", "uiu"],
    ["мме", "miu"],
    ["кме", "kiu"],
    ["ме", "iu"],
    ["мкед", "uu"],
    ["мед", "mu"],
    ["ед", "u"],
    ["мкг", "ug"],
    ["мг", "mg"],
    ["нг", "ng"],
    ["пг", "pg"],
    ["кг", "kg"],
    ["г", "g"],
    ["мкл", "ul"],
    ["мл", "ml"],
    ["дл", "dl"],
    ["фл", "fl"],
    ["литр", "l"],
    ["л", "l"],
    ["млн", "106"],
    ["тыс", "103"],
    ["час", "h"],
    ["ч", "h"],
    ["мин", "min"],
    ["сек", "s"],
    ["с", "s"],
    ["мм", "mm"],
    ["мэкв", "meq"],
    ["экв", "eq"],
    ["е", "u"],
  ] as const
).toSorted((left, right) => right[0].length - left[0].length);

export function normalizeAnalyteUnit(value: string): string {
  let unit = compact(value)
    .toLocaleLowerCase("ru-RU")
    .replaceAll(" ", "")
    .replaceAll("μ", "u")
    .replaceAll("µ", "u");
  for (const [cyrillic, latin] of cyrillicUnitAtoms) unit = unit.replaceAll(cyrillic, latin);
  // Powers of ten come printed as 10^9, 10*9, ×10⁹ (NFKC already lowered the superscript) or,
  // out of a PDF text layer, "10 9 /л": one spelling for all of them.
  return unit.replace(/[×xх*]?10[\^*eе]?(\d{1,2})/g, "10$1");
}

function normalizedDecimal(value: string): string | null {
  const compactValue = value.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+|\d+\.\d+)$/.test(compactValue)) return null;
  return Number.isFinite(Number(compactValue)) ? compactValue : null;
}

function laboratoryKey(value: string | null): string {
  return value === null ? "*" : normalizeAnalyteName(value);
}

export async function resolveAnalyteMapping(
  database: DatabaseClient,
  input: AnalyteMappingInput,
): Promise<ResolvedAnalyteMapping | null> {
  const nameKey = normalizeAnalyteName(input.sourceName);
  const unitKey = normalizeAnalyteUnit(input.sourceUnit);
  const labKey = laboratoryKey(input.proposedLaboratory);
  const mappings = await database.query<AnalyteMappingRow>(
    `SELECT catalog.canonical_code, catalog.canonical_unit, catalog.display_name,
            alias.source_name_key, alias.source_unit_key
       FROM analyte_aliases alias
       JOIN analyte_catalog catalog
         ON catalog.canonical_code = alias.canonical_code
      WHERE alias.source_name_key = $1
        AND alias.source_unit_key = $2
        AND alias.laboratory_key IN ('*', $3)
        AND alias.status = 'confirmed'
      ORDER BY CASE WHEN alias.laboratory_key = $3 THEN 0 ELSE 1 END, alias.id
      LIMIT 1`,
    [nameKey, unitKey, labKey],
  );
  const mapping = mappings.rows[0];
  if (mapping === undefined) return null;
  if (mapping.source_name_key !== nameKey || mapping.source_unit_key !== unitKey) {
    throw new Error("Analyte mapping lookup returned an inconsistent alias");
  }
  // The normalized value is always the printed number, and only when the alias unit is the
  // canonical unit under another spelling. Veylta performs no unit conversions, so an alias
  // whose unit differs from the canonical one applies the code and leaves the value alone.
  const normalizedValue =
    normalizeAnalyteUnit(mapping.canonical_unit) === mapping.source_unit_key
      ? normalizedDecimal(input.sourceValue)
      : null;
  return {
    canonicalCode: mapping.canonical_code,
    displayName: mapping.display_name,
    normalizedValue,
    normalizedUnit: normalizedValue === null ? null : mapping.canonical_unit,
  };
}

/** Apply only a locally stored alias; unknown analytes stay unresolved. */
export async function enrichFactFromAnalyteMappings(
  database: DatabaseClient,
  fact: StrictLabExtractionFact,
): Promise<StrictLabExtractionFact> {
  const mapping = await resolveAnalyteMapping(database, fact);
  if (mapping === null) return fact;
  return {
    ...fact,
    proposedCanonicalCode: mapping.canonicalCode,
    proposedNormalizedValue: mapping.normalizedValue,
    proposedNormalizedUnit: mapping.normalizedUnit,
  };
}

const aliasSeparator = " | ";

/**
 * The catalog as the model sees it: every known code with its display name, unit and the
 * confirmed source spellings, so a request always carries the family's own vocabulary.
 * Bounded; the provider trims further before it reaches the prompt.
 */
export async function loadAnalyteCatalogForPrompt(
  database: DatabaseClient,
): Promise<readonly AnalyteCatalogEntry[]> {
  const rows = await database.query<{
    canonical_code: string;
    display_name: string;
    canonical_unit: string;
    aliases: string | null;
  }>(
    `SELECT c.canonical_code, c.display_name, c.canonical_unit,
            (SELECT group_concat(a.source_name_key, $1)
               FROM analyte_aliases a
              WHERE a.canonical_code = c.canonical_code AND a.status = 'confirmed') AS aliases
       FROM analyte_catalog c
      ORDER BY c.canonical_code
      LIMIT 400`,
    [aliasSeparator],
  );
  return rows.rows.map((row) => ({
    code: row.canonical_code,
    displayName: row.display_name,
    unit: row.canonical_unit,
    aliases:
      row.aliases === null ? [] : [...new Set(row.aliases.split(aliasSeparator))].slice(0, 6),
  }));
}
