/**
 * The answer model: what an assistant may say — an urgency and typed, evidence-bound blocks —
 * and the evidence items the UI resolves their references to. The vocabularies live in
 * ./assistant.ts; the server refuses any block that does not fit this shape.
 */
import type {
  AssistantActivityKind,
  AssistantClearanceState,
  AssistantConfidence,
  AssistantContraindicationState,
  AssistantDietCategory,
  AssistantMissingContext,
  AssistantSpecialty,
  AssistantTreatmentKind,
  AssistantUrgencyTier,
} from "./assistant.js";

/** A confirmed observation the answer rests on; the UI resolves it to its source link. */
export interface AssistantEvidenceRef {
  readonly observationId: string;
}

/** What a ref resolves to: the printed value and the page it was confirmed from. */
export interface AssistantEvidenceItem {
  readonly observationId: string;
  readonly code: string | null;
  readonly name: string;
  readonly value: string;
  readonly unit: string;
  readonly sampledAt: string | null;
  readonly documentId: string;
  readonly pageNumber: number;
}

export interface AssistantUrgency {
  readonly tier: AssistantUrgencyTier;
  readonly reasons: readonly AssistantEvidenceRef[];
}

/** How the assistant's own read stands to one confirmed clinician record. */
export const ASSISTANT_CLINICIAN_CHECK_CLAIMS = ["agree", "differs", "cannot_assess"] as const;
export type AssistantClinicianCheckClaim = (typeof ASSISTANT_CLINICIAN_CHECK_CLAIMS)[number];

/** A confirmed clinician record the answer speaks to; the UI resolves it to the record. */
export interface AssistantRecordRef {
  readonly recordId: string;
}

/** What a record ref resolves to: the statement as confirmed and the document it came from. */
export interface AssistantEvidenceRecordItem {
  readonly recordId: string;
  readonly kind: string;
  readonly label: string;
  readonly detail: string | null;
  readonly documentDate: string | null;
  readonly documentId: string;
  readonly pageNumber: number;
}

export type AssistantBlock =
  | {
      readonly kind: "interpretation";
      readonly text: string;
      readonly refs: readonly AssistantEvidenceRef[];
    }
  | {
      readonly kind: "hypothesis";
      readonly name: string;
      readonly confidence: AssistantConfidence;
      readonly rationale: string;
      readonly refs: readonly AssistantEvidenceRef[];
      readonly confirmWith: AssistantSpecialty;
      readonly workup: readonly string[];
    }
  | {
      readonly kind: "treatment_option";
      readonly name: string;
      readonly treatmentKind: AssistantTreatmentKind;
      readonly rationale: string;
      readonly refs: readonly AssistantEvidenceRef[];
      readonly contraindications: AssistantContraindicationState;
      readonly conflictNotes: string | null;
      readonly confirmWith: AssistantSpecialty;
    }
  | {
      readonly kind: "question";
      readonly text: string;
      readonly refs: readonly AssistantEvidenceRef[];
    }
  | {
      /** The сверка: the assistant's own read set against one confirmed clinician record. */
      readonly kind: "clinician_check";
      readonly claim: AssistantClinicianCheckClaim;
      readonly theirs: AssistantRecordRef;
      /** The assistant's own position in one sentence. */
      readonly ours: string;
      readonly why: string;
      readonly refs: readonly AssistantEvidenceRef[];
      /** Whom to bring a difference to — never a verdict on the clinician. */
      readonly confirmWith: AssistantSpecialty;
    }
  | {
      /** The nutritionist: what the values and the profile say about the person's diet. */
      readonly kind: "diet_assessment";
      readonly text: string;
      readonly refs: readonly AssistantEvidenceRef[];
    }
  | {
      /** One concrete diet recommendation, checked against the profile, confirmed by a named specialty. */
      readonly kind: "diet_recommendation";
      readonly name: string;
      readonly category: AssistantDietCategory;
      readonly rationale: string;
      readonly refs: readonly AssistantEvidenceRef[];
      /** Against the recorded conditions, medications, allergies and pregnancy — like a treatment option. */
      readonly interaction: AssistantContraindicationState;
      readonly conflictNotes: string | null;
      readonly confirmWith: AssistantSpecialty;
    }
  | {
      /** The trainer: what the values, constraints and clearance say about the person's load. */
      readonly kind: "activity_assessment";
      readonly text: string;
      readonly refs: readonly AssistantEvidenceRef[];
    }
  | {
      /** One activity, its load and progression in the assistant's own words, cleared or not. */
      readonly kind: "activity_recommendation";
      readonly name: string;
      readonly activityKind: AssistantActivityKind;
      /** How much and how often, as a phrase — never a schedule Veylta computes. */
      readonly load: string;
      readonly progression: string | null;
      readonly rationale: string;
      readonly refs: readonly AssistantEvidenceRef[];
      readonly clearance: AssistantClearanceState;
      /** A recorded activity constraint or clearance the load touches, named. */
      readonly conflictNotes: string | null;
      readonly confirmWith: AssistantSpecialty;
    }
  | {
      /** What to measure again and when, so the plan can carry it as a laboratory item. */
      readonly kind: "recheck";
      readonly text: string;
      readonly when: string;
      readonly refs: readonly AssistantEvidenceRef[];
    }
  | { readonly kind: "general"; readonly text: string }
  | { readonly kind: "missing"; readonly context: AssistantMissingContext };

export interface AssistantAnswer {
  readonly urgency: AssistantUrgency;
  readonly blocks: readonly AssistantBlock[];
}
