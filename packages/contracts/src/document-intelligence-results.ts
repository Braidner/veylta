/** The closed vocabularies of a structured result the document intelligence extracts. */
export const DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES = [
  "measurement",
  "genetic_variant",
  "finding",
  "procedure",
  "medication",
  "diagnosis",
  "referral",
  "follow_up",
  "other",
] as const;
export const DOCUMENT_INTELLIGENCE_RESULT_STATUSES = [
  "above_range",
  "normal",
  "abnormal",
  "detected",
  "not_detected",
  "completed",
  "informational",
  "unknown",
] as const;

export type DocumentIntelligenceStructuredResultType =
  (typeof DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES)[number];
export type DocumentIntelligenceResultStatus =
  (typeof DOCUMENT_INTELLIGENCE_RESULT_STATUSES)[number];
