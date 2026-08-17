/**
 * The second-opinion assistants: profile-scoped Codex conversations whose every answer is a set
 * of typed, evidence-bound blocks with an urgency tier — never free prose. See
 * docs/assistants.md for the model; the server refuses anything that does not fit it.
 */
export const ASSISTANT_CONTRACT_VERSION = "assistant/v2" as const;
export * from "./assistant-workspace.js";

export const ASSISTANT_IDS = ["physician"] as const;
export const ASSISTANT_URGENCY_TIERS = ["none", "routine", "soon", "urgent", "emergency"] as const;
export const ASSISTANT_CONFIDENCE_LEVELS = ["low", "moderate", "high"] as const;
export const ASSISTANT_TREATMENT_KINDS = [
  "lifestyle",
  "medication_class",
  "medication",
  "procedure",
  "referral",
] as const;
export const ASSISTANT_CONTRAINDICATION_STATES = [
  "checked_clear",
  "checked_conflict",
  "unknown",
] as const;
export const ASSISTANT_SPECIALTIES = [
  "therapist",
  "endocrinologist",
  "cardiologist",
  "gastroenterologist",
  "hematologist",
  "nephrologist",
  "gynecologist",
  "urologist",
  "neurologist",
  "dermatologist",
  "pulmonologist",
  "rheumatologist",
  "oncologist",
  "infectious_disease",
  "dietitian",
  "physiotherapist",
  "psychiatrist",
  "emergency",
  "other",
] as const;
export const ASSISTANT_MISSING_CONTEXTS = [
  "sex",
  "birth_year",
  "medications",
  "conditions",
  "allergies",
  "symptoms",
  "recent_values",
] as const;
/** Closed reasons an answer is refused; rendered through fixed Russian copy, never model text. */
export const ASSISTANT_REJECTION_REASONS = [
  "schema_shape",
  "not_russian",
  "unbound_reference",
  "missing_urgency",
  "prescriptive_dose",
  "general_names_values",
  "checker_unsafe",
  "profile_not_ready",
  "response_too_large",
  "provider_unavailable",
] as const;
export const ASSISTANT_CHECKER_VERDICTS = [
  "supported",
  "overreach",
  "contradicted",
  "unsafe",
] as const;
export const ASSISTANT_EGRESS_ACKNOWLEDGEMENT = "send_confirmed_evidence_to_codex" as const;
export const ASSISTANT_AGREEMENT_VERDICTS = ["agree", "differ"] as const;
export const MAX_ASSISTANT_CONVERSATIONS = 20;
export const MAX_ASSISTANT_MESSAGE_LENGTH = 2_000;
export const MAX_ASSISTANT_BLOCKS = 40;
/** A консилиум convenes at most this many specialists besides the therapist. */
export const MAX_CONSILIUM_SPECIALISTS = 5;
export const MAX_CONSILIUM_AGREEMENTS = 12;

export type AssistantId = (typeof ASSISTANT_IDS)[number];
export type AssistantUrgencyTier = (typeof ASSISTANT_URGENCY_TIERS)[number];
export type AssistantConfidence = (typeof ASSISTANT_CONFIDENCE_LEVELS)[number];
export type AssistantTreatmentKind = (typeof ASSISTANT_TREATMENT_KINDS)[number];
export type AssistantContraindicationState = (typeof ASSISTANT_CONTRAINDICATION_STATES)[number];
export type AssistantSpecialty = (typeof ASSISTANT_SPECIALTIES)[number];
export type AssistantMissingContext = (typeof ASSISTANT_MISSING_CONTEXTS)[number];
export type AssistantRejectionReason = (typeof ASSISTANT_REJECTION_REASONS)[number];
export type AssistantCheckerVerdict = (typeof ASSISTANT_CHECKER_VERDICTS)[number];
export type AssistantAgreementVerdict = (typeof ASSISTANT_AGREEMENT_VERDICTS)[number];

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
  | { readonly kind: "general"; readonly text: string }
  | { readonly kind: "missing"; readonly context: AssistantMissingContext };

export interface AssistantAnswer {
  readonly urgency: AssistantUrgency;
  readonly blocks: readonly AssistantBlock[];
}
