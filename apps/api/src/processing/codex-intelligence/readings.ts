// What a printed reading is: its number, its unit, whether it lies above the printed range.
// Everything here works on the source's own text; nothing is converted or taken on trust.
import type { StrictLabExtractionFact } from "../synthetic-lab-parser.js";

export function numericSourceValue(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The same printed number, whether written "5,82" or "5.82"; non-numeric readings must match verbatim. */
export function sameReading(left: string, right: string): boolean {
  if (left === right) return true;
  const leftNumber = numericSourceValue(left);
  return leftNumber !== null && leftNumber === numericSourceValue(right);
}

/**
 * Some models repeat the unit inside the value ("13,34 пмоль/л" next to a unit of "пмоль/л").
 * The unit is a separate required field, so the repetition carries no information: it is
 * trimmed off, and only it — the printed value is otherwise left verbatim. A unit that begins
 * with a letter or digit is trimmed only across a whitespace boundary, so a value that merely
 * ends in the unit's characters is never shortened.
 */
export function valueWithoutRepeatedUnit(value: string, unit: string | null): string {
  if (unit === null || value.length <= unit.length || !value.endsWith(unit)) return value;
  const remainder = value.slice(0, -unit.length);
  const boundary = remainder.at(-1) ?? "";
  if (/^[\p{L}\p{N}]/u.test(unit) && !/\s/.test(boundary)) return value;
  const trimmed = remainder.trimEnd();
  return trimmed.length === 0 ? value : trimmed;
}

export interface Normalization {
  readonly value: string | null;
  readonly unit: string | null;
}

/**
 * A proposed normalization is a claim Veylta can check only in the identity case: the printed
 * number under a canonical spelling of the unit. A value that differs numerically from the
 * printed one would be a unit conversion on the model's word alone, so the pair is dropped and
 * the fact keeps only what the source printed. Half a proposal — value or unit alone — is no
 * proposal at all.
 */
export function verifiedNormalization(
  sourceValue: string,
  value: string | null,
  unit: string | null,
): Normalization {
  if (value === null || unit === null) return { value: null, unit: null };
  const printed = numericSourceValue(sourceValue);
  const proposed = numericSourceValue(value);
  return printed !== null && printed === proposed ? { value, unit } : { value: null, unit: null };
}

/**
 * Veylta decides range membership itself, from the bounds the model transcribed out of the
 * document. The model's own status is never taken on trust: a claim it cannot support is
 * downgraded rather than accepted, and a run is never failed over one status.
 */
export function computedAboveRange(fact: StrictLabExtractionFact | undefined): boolean | null {
  const range = fact?.referenceRange;
  if (range === undefined || range === null) return null;
  if (range.laboratoryOutOfRange === true) return true;
  const value = numericSourceValue(fact?.sourceValue);
  const upper = numericSourceValue(range.sourceHigh);
  if (value === null || upper === null) return null;
  return value > upper;
}
