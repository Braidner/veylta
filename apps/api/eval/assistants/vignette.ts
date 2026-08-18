// A synthetic vignette: the evidence one assistant turn sees, the person's question, and what a
// careful second opinion must and must not say. Everything here is invented; nothing describes a
// real person. The runner turns a vignette into the same AssistantEvidence the API builds.
import {
  ASSISTANT_URGENCY_TIERS,
  type AssistantBlock,
  type AssistantId,
  type AssistantMissingContext,
  type AssistantSpecialty,
  type AssistantUrgencyTier,
  type MedicalProfileEntryKind,
} from "@veylta/contracts";
import type { AssistantEvidence, AssistantPlanItem } from "../../src/assistant/evidence.js";

export interface VignetteObservation {
  readonly code: string | null;
  readonly name: string;
  readonly value: string;
  readonly unit: string;
  readonly low: string | null;
  readonly high: string | null;
  /** The laboratory's own flag when the printed report carried one. */
  readonly flag?: boolean;
}

export interface VignetteExpectation {
  /** The answer's urgency may not be lower than this — a soft alarm is a failure. */
  readonly minUrgency: AssistantUrgencyTier;
  /** …and, when set, not higher — inflating routine findings is a failure too. */
  readonly maxUrgency?: AssistantUrgencyTier;
  /** At least one hypothesis / recommendation names one of these (name or rationale). */
  readonly names?: readonly RegExp[];
  /** Some block refers to one of these specialties. */
  readonly specialties?: readonly AssistantSpecialty[];
  /** Block kinds the answer must contain. */
  readonly kinds?: readonly AssistantBlock["kind"][];
  /** Phrases no text of the answer may carry (a dose, a diagnosis stated as fact, …). */
  readonly forbid?: readonly RegExp[];
  /** Missing contexts the answer must ask for. */
  readonly missing?: readonly AssistantMissingContext[];
}

export interface Vignette {
  readonly id: string;
  readonly assistantId: AssistantId;
  readonly title: string;
  readonly profile: readonly { readonly kind: MedicalProfileEntryKind; readonly value: string }[];
  readonly observations: readonly VignetteObservation[];
  readonly records?: readonly {
    readonly kind: string;
    readonly label: string;
    readonly detail: string | null;
  }[];
  readonly plan?: readonly AssistantPlanItem[];
  readonly question: string;
  readonly expect: VignetteExpectation;
}

/** One line of a synthetic laboratory report. */
export function lab(
  code: string | null,
  name: string,
  value: string,
  unit: string,
  range: readonly [string | null, string | null] = [null, null],
  flag?: boolean,
): VignetteObservation {
  return {
    code,
    name,
    value,
    unit,
    low: range[0],
    high: range[1],
    ...(flag === undefined ? {} : { flag }),
  };
}

/** A synthetic evidence bundle exactly as the API would send it; ids are deterministic per vignette. */
export function evidenceOf(vignette: Vignette): AssistantEvidence {
  const kinds = new Set(vignette.profile.map((entry) => entry.kind));
  return {
    medicalProfile: {
      interpretationReady: kinds.has("sex") && kinds.has("birth_year"),
      entries: vignette.profile.map((entry) => ({ ...entry, recordedOn: null })),
    },
    observations: vignette.observations.map((observation, index) => ({
      observationId: observationId(vignette.id, index),
      code: observation.code,
      name: observation.name,
      value: observation.value,
      unit: observation.unit,
      referenceRange:
        observation.low === null && observation.high === null
          ? null
          : {
              text: `${observation.low ?? ""}–${observation.high ?? ""} ${observation.unit}`.trim(),
              low: observation.low,
              high: observation.high,
              laboratoryFlag: observation.flag ?? null,
            },
      sampledAt: "2026-08-01",
      laboratory: "Синтетическая лаборатория",
    })),
    clinicianRecords: (vignette.records ?? []).map((record, index) => ({
      recordId: recordId(vignette.id, index),
      kind: record.kind,
      label: record.label,
      detail: record.detail,
      documentDate: "2026-07-20",
    })),
    carePlan: vignette.plan ?? [],
  };
}

export function observationId(vignetteId: string, index: number): string {
  return `${hex(vignetteId).slice(0, 8)}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function recordId(vignetteId: string, index: number): string {
  return `${hex(vignetteId).slice(0, 8)}-0000-4000-8000-${String(100 + index).padStart(12, "0")}`;
}

/** A stable eight-hex prefix from the vignette id — no randomness, so a re-run reads the same. */
function hex(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `${hash.toString(16).padStart(8, "0")}${hash.toString(16).padStart(8, "0")}`;
}

export const tierRank = (tier: AssistantUrgencyTier): number =>
  ASSISTANT_URGENCY_TIERS.indexOf(tier);
