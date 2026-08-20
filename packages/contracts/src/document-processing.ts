/** How a document's analysis reports itself: its states, its closed reasons, its status union. */

export const DOCUMENT_PROCESSING_STATES = [
  "not_started",
  "queued",
  "security_check",
  "text_extraction",
  "document_classification",
  "structured_extraction",
  "validation",
  "awaiting_review",
  "completed",
  "failed",
] as const;

export const DOCUMENT_PROCESSING_FAILURE_CATEGORIES = [
  "document_unavailable",
  "invalid_document",
  "agent_unavailable",
  "agent_output_invalid",
  "extraction_failed",
  "validation_failed",
  "attempts_exhausted",
] as const;

/**
 * Safe, payload-free facts recorded by the worker as processing advances.
 * These are observable state transitions, never model reasoning or source text.
 */
export const DOCUMENT_PROCESSING_EVENT_CODES = [
  "queued",
  "security_check_started",
  "text_extraction_started",
  "document_classification_started",
  "codex_analysis_started",
  "result_validation_started",
  "result_saved",
  "retry_scheduled",
  "failed",
] as const;

/**
 * Why one Codex answer was refused. A closed vocabulary: a reason is always a code the
 * server derived, never a sentence the model produced.
 */
export const PROCESSING_REJECTION_REASONS = [
  "schema_shape",
  "not_russian",
  "unknown_page",
  "fragment_not_on_page",
  "invalid_key",
  "invalid_number",
  "invalid_timestamp",
  "inconsistent_fields",
  "unproven_above_range",
  "duplicate_binding",
  "incomplete_facts",
  "response_too_large",
  "provider_unavailable",
  "input_invalid",
] as const;

export type DocumentProcessingState = (typeof DOCUMENT_PROCESSING_STATES)[number];
export type DocumentProcessingFailureCategory =
  (typeof DOCUMENT_PROCESSING_FAILURE_CATEGORIES)[number];
export type DocumentProcessingEventCode = (typeof DOCUMENT_PROCESSING_EVENT_CODES)[number];
export type ProcessingRejectionReason = (typeof PROCESSING_REJECTION_REASONS)[number];

export interface DocumentProcessingNotStarted {
  readonly state: "not_started";
}

export interface DocumentProcessingQueued {
  readonly state: "queued";
  readonly updatedAt: string;
}

export interface DocumentProcessingActive {
  readonly state:
    | "security_check"
    | "text_extraction"
    | "document_classification"
    | "structured_extraction"
    | "validation";
  readonly updatedAt: string;
}

export interface DocumentProcessingAwaitingReview {
  readonly state: "awaiting_review";
  readonly updatedAt: string;
  readonly factCount: number;
  readonly needsReviewCount: number;
}

export interface DocumentProcessingCompleted {
  readonly state: "completed";
  readonly updatedAt: string;
  readonly factCount: number;
}

export interface DocumentProcessingFailed {
  readonly state: "failed";
  readonly updatedAt: string;
  readonly category: DocumentProcessingFailureCategory;
  readonly retryAllowed: boolean;
}

export type DocumentProcessingStatus =
  | DocumentProcessingNotStarted
  | DocumentProcessingQueued
  | DocumentProcessingActive
  | DocumentProcessingAwaitingReview
  | DocumentProcessingCompleted
  | DocumentProcessingFailed;
