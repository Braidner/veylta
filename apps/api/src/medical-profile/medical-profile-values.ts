import {
  MEDICAL_PROFILE_PREGNANCY_VALUES,
  MEDICAL_PROFILE_SEX_VALUES,
  type MedicalProfileEntryKind,
} from "@veylta/contracts";
import { DomainValidationError } from "../family/family-service.js";

const maximumTextLength = 300;
const earliestBirthYear = 1900;

function boundedText(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > maximumTextLength) throw new DomainValidationError();
  if ([...trimmed].some((character) => (character.codePointAt(0) ?? 0) < 32)) {
    throw new DomainValidationError();
  }
  return trimmed;
}

function boundedNumber(value: string, minimum: number, maximum: number, integer: boolean): string {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d)?$/.test(normalized)) throw new DomainValidationError();
  const parsed = Number(normalized);
  if (integer && !Number.isInteger(parsed)) throw new DomainValidationError();
  if (parsed < minimum || parsed > maximum) throw new DomainValidationError();
  return String(parsed);
}

function closedValue(value: string, allowed: readonly string[]): string {
  const normalized = value.trim();
  if (!allowed.includes(normalized)) throw new DomainValidationError();
  return normalized;
}

/**
 * A recorded value is what the person typed, normalised only where the kind is closed or
 * numeric: sex and pregnancy are codes, the birth year is a plausible year, height and weight
 * plausible measurements. Free-text kinds keep their wording, trimmed and bounded.
 */
export function medicalProfileEntryValue(kind: MedicalProfileEntryKind, value: string): string {
  switch (kind) {
    case "sex":
      return closedValue(value, MEDICAL_PROFILE_SEX_VALUES);
    case "pregnancy":
      return closedValue(value, MEDICAL_PROFILE_PREGNANCY_VALUES);
    case "birth_year":
      return boundedNumber(value, earliestBirthYear, new Date().getUTCFullYear(), true);
    case "height_cm":
      return boundedNumber(value, 50, 250, false);
    case "weight_kg":
      return boundedNumber(value, 2, 400, false);
    default:
      return boundedText(value);
  }
}
