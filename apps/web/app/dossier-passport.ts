import type { MedicalProfileEntryKind } from "@veylta/contracts";
import { countCopy } from "./russian-plural";

/** What the person recorded about themselves, read as facts for the top of their dossier. */
const numberOf = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

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
