import { CARE_PLAN_CATEGORIES, CARE_PLAN_ITEM_STATES } from "@veylta/contracts";
import { DomainValidationError } from "../family/family-service.js";

export const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
export const categorySet = new Set<string>(CARE_PLAN_CATEGORIES);
export const stateSet = new Set<string>(CARE_PLAN_ITEM_STATES);

export function canonicalItemId(value: string): string {
  const id = value.toLowerCase();
  if (!canonicalUuidPattern.test(id)) throw new DomainValidationError();
  return id;
}

export function timestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new DomainValidationError();
  }
  return value;
}

export function localDate(value: string | null): string | null {
  if (value === null) return null;
  if (!localDatePattern.test(value)) throw new DomainValidationError();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainValidationError();
  }
  return value;
}

export function boundedText(value: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) throw new DomainValidationError();
  return normalized;
}

export function optionalText(value: string | null, maximum: number): string | null {
  return value === null ? null : boundedText(value, maximum);
}

export function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Stored ${label} is invalid`);
  }
  return value;
}

export function missingContext(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (item) =>
          typeof item !== "string" ||
          !/^[a-z0-9_]{1,120}$/.test(item) ||
          parsed.indexOf(item) !== parsed.lastIndexOf(item),
      )
    ) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new Error("Stored care plan context is invalid");
  }
}

export function storedStringArray(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new Error("Stored health summary context is invalid");
  }
}
