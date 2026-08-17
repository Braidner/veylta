/** The user-authored medical profile the assistants reason over. */
export const MEDICAL_PROFILE_CONTRACT_VERSION = "medical-profile/v2" as const;
/**
 * What a person may record about themselves for the assistants to reason over. Every entry is
 * user-authored and dated; the assistants never infer these. Singleton kinds hold one active
 * value per profile, the rest are lists.
 */
export const MEDICAL_PROFILE_ENTRY_KINDS = [
  "sex",
  "birth_year",
  "height_cm",
  "weight_kg",
  "pregnancy",
  "condition",
  "medication",
  "allergy",
  "intolerance",
  "family_history",
  "symptom",
  "goal",
  "dietary_restriction",
  "activity_constraint",
  "clearance",
  "note",
] as const;
export const MEDICAL_PROFILE_SINGLETON_KINDS = [
  "sex",
  "birth_year",
  "height_cm",
  "weight_kg",
  "pregnancy",
] as const;
export const MEDICAL_PROFILE_SEX_VALUES = ["female", "male"] as const;
export const MEDICAL_PROFILE_PREGNANCY_VALUES = ["none", "pregnant", "lactating"] as const;
export const MAX_MEDICAL_PROFILE_ENTRIES = 200;

export type MedicalProfileEntryKind = (typeof MEDICAL_PROFILE_ENTRY_KINDS)[number];

export interface MedicalProfileEntry {
  readonly id: string;
  readonly kind: MedicalProfileEntryKind;
  /** Free text, or a closed code for `sex` and `pregnancy`; a number as text for measurements. */
  readonly value: string;
  /** The local calendar date the entry refers to (a weight, a symptom), when the person gave one. */
  readonly recordedOn: string | null;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One recorded body measurement, active or archived — a weight or a height as the person wrote it. */
export interface MedicalProfileMeasurement {
  readonly value: string;
  readonly recordedOn: string | null;
  /** When it was written down; orders points that carry no date. */
  readonly at: string;
}

export interface MedicalProfileResponse {
  readonly contractVersion: typeof MEDICAL_PROFILE_CONTRACT_VERSION;
  readonly profileId: string;
  readonly canWrite: boolean;
  /** Active entries only — what the assistants read and the editor shows. */
  readonly entries: readonly MedicalProfileEntry[];
  /** Height and weight over time, oldest first, archived measurements included. */
  readonly measurements: {
    readonly heightCm: readonly MedicalProfileMeasurement[];
    readonly weightKg: readonly MedicalProfileMeasurement[];
  };
  /** The two facts without which an assistant refuses to interpret values. */
  readonly interpretationReady: boolean;
}

export interface MedicalProfileEntryCreateRequest {
  readonly kind: MedicalProfileEntryKind;
  readonly value: string;
  readonly recordedOn: string | null;
}

export interface MedicalProfileEntryUpdateRequest {
  readonly revision: number;
  readonly value: string;
  readonly recordedOn: string | null;
}

export interface MedicalProfileEntryArchiveRequest {
  readonly revision: number;
}

export interface MedicalProfileEntryResponse {
  readonly contractVersion: typeof MEDICAL_PROFILE_CONTRACT_VERSION;
  readonly profileId: string;
  readonly entry: MedicalProfileEntry;
}
