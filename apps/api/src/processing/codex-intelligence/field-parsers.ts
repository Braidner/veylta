// Readers for the primitive fields of a Codex answer. Each one either returns a verified value
// or refuses the answer through invalidOutput; nothing is coerced or guessed.
import { invalidOutput } from "./errors.js";

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidOutput();
  return value as Record<string, unknown>;
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) invalidOutput();
}

/** One member of a closed list, or the answer breaks its schema. */
export function oneOf<Member extends string>(value: unknown, members: readonly Member[]): Member {
  if (typeof value !== "string" || !members.includes(value as Member)) invalidOutput();
  return value as Member;
}

/**
 * A printed phrase the model copied across a line break — a name broken over two lines, say —
 * is the same phrase; whitespace runs collapse to one space before the bound is applied.
 */
export function printedPhrase(value: unknown, maximum: number): string {
  return boundedString(
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value,
    maximum,
  );
}

export function boundedString(value: unknown, maximum: number): string {
  const hasControlCharacter =
    typeof value === "string" &&
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    });
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value !== value.trim() ||
    hasControlCharacter
  ) {
    invalidOutput("schema_shape");
  }
  return value;
}

export function russianBoundedString(value: unknown, maximum: number): string {
  const result = boundedString(value, maximum);
  if (!/[А-Яа-яЁё]/u.test(result)) invalidOutput("not_russian");
  return result;
}

export function optionalBoundedString(value: unknown, maximum: number): string | null {
  return value === null ? null : boundedString(value, maximum);
}

export function confidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    invalidOutput("invalid_number");
  }
  return value;
}

export function canonicalTimestamp(value: unknown): string | null {
  if (value === null) return null;
  const timestamp = boundedString(value, 40);
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== timestamp)
    invalidOutput("invalid_timestamp");
  return timestamp;
}

/** A calendar date; an impossible one (30 February) is dropped rather than failing the run. */
export function canonicalDate(value: unknown): string | null {
  if (value === null) return null;
  const date = boundedString(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) invalidOutput("invalid_timestamp");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return null;
  }
  return date;
}
