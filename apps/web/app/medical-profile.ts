import type {
  MEDICAL_PROFILE_PREGNANCY_VALUES,
  MEDICAL_PROFILE_SEX_VALUES,
  MedicalProfileEntry,
  MedicalProfileEntryKind,
} from "@veylta/contracts";
import { MEDICAL_PROFILE_SINGLETON_KINDS } from "@veylta/contracts";

export type MedicalProfileGroupId = "basics" | "health" | "wellbeing" | "goals" | "notes";

export interface MedicalProfileGroup {
  readonly id: MedicalProfileGroupId;
  readonly title: string;
  readonly kinds: readonly MedicalProfileEntryKind[];
}

/** How the person is asked for a value of this kind. */
export type MedicalProfileInput =
  | { readonly control: "select"; readonly options: readonly { value: string; label: string }[] }
  | {
      readonly control: "number";
      readonly unit: string;
      readonly min: number;
      readonly max: number;
    }
  | { readonly control: "text"; readonly placeholder: string; readonly dated: boolean };

export const medicalProfileGroups: readonly MedicalProfileGroup[] = [
  {
    id: "basics",
    title: "Основное",
    kinds: ["sex", "birth_year", "height_cm", "weight_kg", "pregnancy"],
  },
  {
    id: "health",
    title: "Состояния и лекарства",
    kinds: ["condition", "medication", "allergy", "intolerance", "family_history"],
  },
  { id: "wellbeing", title: "Самочувствие", kinds: ["symptom"] },
  {
    id: "goals",
    title: "Цели и ограничения",
    kinds: ["goal", "dietary_restriction", "activity_constraint", "clearance"],
  },
  { id: "notes", title: "Заметки", kinds: ["note"] },
];

export const medicalProfileKindLabels: Record<MedicalProfileEntryKind, string> = {
  sex: "Пол",
  birth_year: "Год рождения",
  height_cm: "Рост",
  weight_kg: "Вес",
  pregnancy: "Беременность / кормление",
  condition: "Состояние или диагноз (как поставил врач)",
  medication: "Лекарство и как принимаете",
  allergy: "Аллергия",
  intolerance: "Непереносимость",
  family_history: "Семейный анамнез",
  symptom: "Симптом или жалоба",
  goal: "Цель",
  dietary_restriction: "Ограничение в питании",
  activity_constraint: "Ограничение по нагрузке",
  clearance: "Допуск врача к нагрузке",
  note: "Заметка",
};

const sexLabels: Record<(typeof MEDICAL_PROFILE_SEX_VALUES)[number], string> = {
  female: "Женский",
  male: "Мужской",
};

const pregnancyLabels: Record<(typeof MEDICAL_PROFILE_PREGNANCY_VALUES)[number], string> = {
  none: "Нет",
  pregnant: "Беременность",
  lactating: "Грудное вскармливание",
};

export function medicalProfileInput(kind: MedicalProfileEntryKind): MedicalProfileInput {
  switch (kind) {
    case "sex":
      return {
        control: "select",
        options: Object.entries(sexLabels).map(([value, label]) => ({ value, label })),
      };
    case "pregnancy":
      return {
        control: "select",
        options: Object.entries(pregnancyLabels).map(([value, label]) => ({ value, label })),
      };
    case "birth_year":
      return { control: "number", unit: "г.", min: 1900, max: new Date().getUTCFullYear() };
    case "height_cm":
      return { control: "number", unit: "см", min: 50, max: 250 };
    case "weight_kg":
      return { control: "number", unit: "кг", min: 2, max: 400 };
    case "medication":
      return { control: "text", placeholder: "Название, доза, как принимаете", dated: true };
    case "symptom":
      return { control: "text", placeholder: "Что беспокоит и как давно", dated: true };
    default:
      return { control: "text", placeholder: "Своими словами", dated: false };
  }
}

/** The value as the person sees it back: closed codes and measurements get their words. */
export function medicalProfileValueCopy(
  entry: Pick<MedicalProfileEntry, "kind" | "value">,
): string {
  switch (entry.kind) {
    case "sex":
      return sexLabels[entry.value as keyof typeof sexLabels] ?? entry.value;
    case "pregnancy":
      return pregnancyLabels[entry.value as keyof typeof pregnancyLabels] ?? entry.value;
    case "height_cm":
      return `${entry.value} см`;
    case "weight_kg":
      return `${entry.value} кг`;
    default:
      return entry.value;
  }
}

export function isSingletonKind(kind: MedicalProfileEntryKind): boolean {
  return (MEDICAL_PROFILE_SINGLETON_KINDS as readonly string[]).includes(kind);
}

/** What the assistants still need before they interpret anything, in the person's words. */
export function medicalProfileReadinessCopy(
  entries: readonly MedicalProfileEntry[],
): string | null {
  const missing = (["sex", "birth_year"] as const).filter(
    (kind) => !entries.some((entry) => entry.kind === kind),
  );
  if (missing.length === 0) return null;
  const words = missing.map((kind) => medicalProfileKindLabels[kind].toLowerCase());
  return `Ассистенты начнут трактовать значения, когда будут указаны ${words.join(" и ")} — без них трактовка была бы гаданием.`;
}
