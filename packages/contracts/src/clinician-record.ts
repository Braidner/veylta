/**
 * The clinician's own record, read out of a document: a diagnosis, a prescription, a referral,
 * a follow-up instruction, a procedure, a finding — as the source states it, bound to its page
 * and fragment. Extracted items are untrusted until a person confirms them; only confirmed
 * records reach the assistants (and the сверка).
 */
export const CLINICIAN_RECORD_CONTRACT_VERSION = "clinician-record/v1" as const;

/** The structured-result types that are a clinician's statement rather than a measurement. */
export const CLINICIAN_RECORD_KINDS = [
  "diagnosis",
  "medication",
  "procedure",
  "referral",
  "follow_up",
  "finding",
] as const;
export const CLINICIAN_RECORD_DECISIONS = ["confirmed", "rejected"] as const;
export const MAX_CLINICIAN_RECORD_TEXT = 500;

export type ClinicianRecordKind = (typeof CLINICIAN_RECORD_KINDS)[number];
export type ClinicianRecordDecision = (typeof CLINICIAN_RECORD_DECISIONS)[number];

/** A confirmed or rejected record: the wording the person stood behind, and when. */
export interface ClinicianRecord {
  readonly id: string;
  readonly decision: ClinicianRecordDecision;
  readonly label: string;
  readonly detail: string | null;
  readonly decidedAt: string;
}

/** One extracted statement of the document's latest analysis, with the person's decision if any. */
export interface ClinicianRecordItem {
  readonly resultKey: string;
  readonly kind: ClinicianRecordKind;
  /** As the model read it from the page. */
  readonly extracted: { readonly label: string; readonly detail: string | null };
  readonly source: { readonly pageNumber: number; readonly fragment: string };
  readonly record: ClinicianRecord | null;
}

export interface ClinicianRecordsResponse {
  readonly contractVersion: typeof CLINICIAN_RECORD_CONTRACT_VERSION;
  readonly documentId: string;
  /** The analysis the items come from; null while the document has no completed analysis. */
  readonly intelligenceResultId: string | null;
  readonly documentDate: string | null;
  readonly items: readonly ClinicianRecordItem[];
}

export interface ClinicianRecordDecisionRequest {
  readonly intelligenceResultId: string;
  readonly decision: "confirm" | "reject";
  /** The person's own wording when the extraction is close but not exact; confirm only. */
  readonly correction?: { readonly label: string; readonly detail: string | null };
}

export interface ClinicianRecordDecisionResponse {
  readonly contractVersion: typeof CLINICIAN_RECORD_CONTRACT_VERSION;
  readonly item: ClinicianRecordItem;
}
