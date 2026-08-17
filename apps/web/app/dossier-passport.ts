import type { MedicalProfileEntryKind, MedicalProfileMeasurement } from "@veylta/contracts";
import { numberOf, type PrintedDelta, printedDelta } from "./dossier-numbers";
import { countCopy } from "./russian-plural";

/** What the person recorded about themselves, read as facts for the top of their dossier. */

export interface Passport {
  readonly sex: "female" | "male" | null;
  readonly birthYear: number | null;
  readonly age: number | null;
  readonly heightCm: number | null;
  readonly weightKg: number | null;
  readonly bmi: number | null;
  readonly pregnancy: string | null;
  readonly conditions: readonly string[];
  readonly medications: readonly string[];
  readonly allergies: readonly string[];
  /** Sex and birth year recorded — the assistants interpret nothing without them. */
  readonly ready: boolean;
}

export function ageFromBirthYear(birthYear: number, now: Date): number {
  return Math.max(0, now.getUTCFullYear() - birthYear);
}

/** The number only — a category («норма», «ожирение») would be a judgement, not a measurement. */
export function bodyMassIndex(heightCm: number | null, weightKg: number | null): number | null {
  if (heightCm === null || weightKg === null || heightCm <= 0) return null;
  const metres = heightCm / 100;
  return Number((weightKg / (metres * metres)).toFixed(1));
}

export function passportOf(
  entries: ReadonlyArray<{ readonly kind: MedicalProfileEntryKind; readonly value: string }>,
  now: Date,
): Passport {
  const single = (kind: MedicalProfileEntryKind) =>
    entries.find((entry) => entry.kind === kind)?.value ?? null;
  const many = (kind: MedicalProfileEntryKind) =>
    entries.filter((entry) => entry.kind === kind).map((entry) => entry.value);
  const sexValue = single("sex");
  const sex = sexValue === "female" || sexValue === "male" ? sexValue : null;
  const birthYear = numberOf(single("birth_year"));
  const heightCm = numberOf(single("height_cm"));
  const weightKg = numberOf(single("weight_kg"));
  return {
    sex,
    birthYear,
    age: birthYear === null ? null : ageFromBirthYear(birthYear, now),
    heightCm,
    weightKg,
    bmi: bodyMassIndex(heightCm, weightKg),
    pregnancy: single("pregnancy"),
    conditions: many("condition"),
    medications: many("medication"),
    allergies: [...many("allergy"), ...many("intolerance")],
    ready: sex !== null && birthYear !== null,
  };
}

const sexLabel = { female: "Женщина", male: "Мужчина" } as const;

/** «Женщина · 34 года · беременность» — or a plain statement that the basics are missing. */
export function identityLine(passport: Passport): string {
  const parts = [
    passport.sex === null ? null : sexLabel[passport.sex],
    passport.age === null ? null : countCopy(passport.age, ["год", "года", "лет"]),
    passport.pregnancy === "pregnant"
      ? "беременность"
      : passport.pregnancy === "lactating"
        ? "лактация"
        : null,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "пол и возраст не указаны" : parts.join(" · ");
}

/** The compact facts a heading can carry: sex and age, then height and weight when recorded. */
export function identityChips(passport: Passport): string[] {
  const chips = passport.ready ? [identityLine(passport)] : [];
  if (passport.heightCm !== null) chips.push(`Рост ${passport.heightCm} см`);
  if (passport.weightKg !== null) {
    chips.push(`Вес ${String(passport.weightKg).replace(".", ",")} кг`);
  }
  return chips;
}

export interface MeasurementPoint {
  readonly printed: string;
  readonly value: number;
  /** The local date the point stands on: the recorded date, else the day it was written. */
  readonly on: string;
}

export interface MeasurementSeries {
  readonly points: readonly MeasurementPoint[];
  readonly latest: MeasurementPoint | null;
  readonly delta: PrintedDelta | null;
  /** Days since the latest point, null when nothing is recorded. */
  readonly ageDays: number | null;
  /** True when it is time to write the number down again — nothing yet, or older than a month. */
  readonly stale: boolean;
}

/** How long a weight or height stays current before the passport asks for a fresh one. */
export const measurementFreshDays = 30;

const dayMs = 24 * 60 * 60 * 1000;

/**
 * A person's own weight or height over time, oldest first; non-numbers dropped. The profile
 * stores numbers with a dot, the passport prints them the Russian way, with a comma.
 */
export function measurementSeries(
  measurements: readonly MedicalProfileMeasurement[],
  now: Date,
): MeasurementSeries {
  const points = measurements.flatMap((measurement) => {
    const value = numberOf(measurement.value);
    if (value === null) return [];
    const on = measurement.recordedOn ?? measurement.at.slice(0, 10);
    return [{ printed: measurement.value.replace(".", ","), value, on }];
  });
  const latest = points[points.length - 1] ?? null;
  const previous = points.length > 1 ? (points[points.length - 2] ?? null) : null;
  const ageDays =
    latest === null
      ? null
      : Math.max(0, Math.floor((now.getTime() - Date.parse(`${latest.on}T00:00:00.000Z`)) / dayMs));
  return {
    points,
    latest,
    delta: latest === null || previous === null ? null : printedDelta(latest, previous),
    ageDays,
    stale: ageDays === null || ageDays > measurementFreshDays,
  };
}
