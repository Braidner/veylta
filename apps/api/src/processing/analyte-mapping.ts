import type { DatabaseClient } from "../database/pool.js";
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
  readonly proposedNormalizedValue: string | null;
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

export function normalizeAnalyteUnit(value: string): string {
  return compact(value)
    .toLocaleLowerCase("ru-RU")
    .replaceAll(" ", "")
    .replaceAll("μ", "u")
    .replaceAll("µ", "u")
    .replaceAll("мкмоль", "umol")
    .replaceAll("ммоль", "mmol")
    .replaceAll("моль", "mol")
    .replaceAll("литр", "l")
    .replaceAll("л", "l");
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
  const normalizedValue = input.proposedNormalizedValue ?? normalizedDecimal(input.sourceValue);
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
