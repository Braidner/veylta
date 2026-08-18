import type {
  AssistantEvidenceItem,
  AssistantEvidenceRecordItem,
  MedicalProfileEntryKind,
} from "@veylta/contracts";

/**
 * What one assistant turn is allowed to see, and exactly what the egress notice names: confirmed
 * observations with their printed ranges, the person's own profile, and the care plan. Never an
 * unconfirmed extraction, never a document, never an identifier beyond the observation ids the
 * answer must cite.
 */
export interface AssistantEvidence {
  readonly medicalProfile: {
    readonly interpretationReady: boolean;
    readonly entries: readonly {
      readonly kind: MedicalProfileEntryKind;
      readonly value: string;
      readonly recordedOn: string | null;
    }[];
  };
  readonly observations: readonly AssistantObservation[];
  /** The clinicians' own confirmed statements — what the сверка sets the assistant's read against. */
  readonly clinicianRecords: readonly AssistantClinicianRecord[];
  readonly carePlan: readonly AssistantPlanItem[];
}

export interface AssistantPlanItem {
  readonly category: string;
  readonly title: string;
  readonly state: string;
  readonly scheduledFor: string | null;
  /** The person's own marks over the check-in window — what was actually done, in their words. */
  readonly adherence?: {
    readonly days: number;
    readonly done: number;
    readonly skipped: number;
    readonly notes: readonly string[];
  };
}

export interface AssistantObservation {
  readonly observationId: string;
  readonly code: string | null;
  readonly name: string;
  readonly value: string;
  readonly unit: string;
  readonly referenceRange: {
    readonly text: string | null;
    readonly low: string | null;
    readonly high: string | null;
    readonly laboratoryFlag: boolean | null;
  } | null;
  readonly sampledAt: string | null;
  readonly laboratory: string | null;
}

export interface AssistantClinicianRecord {
  readonly recordId: string;
  readonly kind: string;
  readonly label: string;
  readonly detail: string | null;
  readonly documentDate: string | null;
}

export interface RecordRow {
  id: string;
  kind: string;
  label: string;
  detail: string | null;
  document_date: string | null;
  document_id: string;
  page_number: number;
}

export interface ObservationRow {
  id: string;
  canonical_code: string | null;
  source_name: string;
  source_value: string;
  source_unit: string;
  sampled_at: string | null;
  resulted_at: string | null;
  uploaded_at: string;
  laboratory: string | null;
  reference_text: string | null;
  reference_low: string | null;
  reference_high: string | null;
  reference_flag: number | null;
  document_id: string;
  page_number: number;
}

/** The evidence as the model sees it, and the source index the UI needs to resolve its refs. */
export interface AssistantEvidenceBundle {
  readonly evidence: AssistantEvidence;
  readonly sources: readonly AssistantEvidenceItem[];
  readonly records: readonly AssistantEvidenceRecordItem[];
}
