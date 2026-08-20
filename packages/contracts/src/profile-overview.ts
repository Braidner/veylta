/** The profile landing view: what a person's record holds, source-first and bounded. */
import type { DocumentEffectiveDate } from "./document-timeline.js";
import type {
  DocumentIntelligenceSummary,
  DocumentProcessingStatus,
  ObservationHistoryItem,
  PatientProfileSummary,
  PROFILE_OVERVIEW_CONTRACT_VERSION,
  SyntheticDocumentContentType,
} from "./index.js";

/**
 * A bounded, source-first profile landing view. It deliberately contains no
 * diagnosis, health score, recommendation, or inferred clinical status.
 */
export interface ProfileOverviewDocument {
  readonly id: string;
  readonly originalFilename: string;
  readonly contentType: SyntheticDocumentContentType;
  readonly uploadedAt: string;
  readonly effectiveDate: DocumentEffectiveDate;
  readonly intelligence: DocumentIntelligenceSummary | null;
  readonly processing: DocumentProcessingStatus;
}

/** A document with raw facts that still require an explicit final decision. */
export interface ProfileOverviewReviewDocument {
  readonly id: string;
  readonly originalFilename: string;
  readonly contentType: SyntheticDocumentContentType;
  readonly uploadedAt: string;
  readonly pendingFactCount: number;
  readonly needsAttentionFactCount: number;
}

export interface ProfileOverviewResponse {
  readonly contractVersion: typeof PROFILE_OVERVIEW_CONTRACT_VERSION;
  readonly profile: PatientProfileSummary;
  /** Active documents of the profile — the «всего» of the documents page; `recentDocuments` is capped. */
  readonly documentCount: number;
  /** Every confirmed observation of the profile — not the three `recentObservations` carries. */
  readonly confirmedCount: number;
  /**
   * How many indicators currently sit outside: the number of distinct indicators whose latest
   * confirmed value is outside its printed range or flagged by the laboratory. Indicators, not
   * values — that is what the dossier's own reading counts and what «3 показателя вне референса»
   * means to a person. `DocumentTimelineEntry.outsideRangeCount` counts values in one document;
   * the two names differ because the units of counting do.
   */
  readonly outsideIndicatorCount: number;
  /** Newest first; bounded to fifty immutable source documents. */
  readonly recentDocuments: readonly ProfileOverviewDocument[];
  readonly reviewQueue: {
    readonly documentCount: number;
    readonly pendingFactCount: number;
    readonly needsAttentionFactCount: number;
    /**
     * Every source still awaiting a decision, newest first, bounded by
     * MAX_PROFILE_OVERVIEW_REVIEW_DOCUMENTS. The archive acts on this list directly, so a
     * shorter projection would make a bulk action silently skip documents.
     */
    readonly documents: readonly ProfileOverviewReviewDocument[];
  };
  /** Newest first; bounded to three explicitly confirmed source values. */
  readonly recentObservations: readonly ObservationHistoryItem[];
}
