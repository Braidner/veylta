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

/**
 * Why a page of the document was never read. Server-derived like every rejection reason, so
 * the page can say what happened to it without quoting a sentence the model produced.
 */
export const DOCUMENT_PAGE_UNREAD_REASONS = [
  /** More picture pages than one bounded vision run may carry. */
  "image_page_limit",
  /** The second pass over the picture pages refused or failed. */
  "vision_unavailable",
] as const;

export type DocumentIntelligenceStructuredResultType =
  (typeof DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES)[number];
export type DocumentIntelligenceResultStatus =
  (typeof DOCUMENT_INTELLIGENCE_RESULT_STATUSES)[number];
export type DocumentPageUnreadReason = (typeof DOCUMENT_PAGE_UNREAD_REASONS)[number];
