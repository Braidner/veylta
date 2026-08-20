/** The profile landing view: what a person's record holds, source-first and bounded. */
import type { AssistantId, AssistantUrgencyTier } from "./assistant.js";
import type { DocumentEffectiveDate } from "./document-timeline.js";
import type {
  DocumentIntelligenceSummary,
  DocumentProcessingStatus,
  ObservationHistoryItem,
  PatientProfileSummary,
  PROFILE_OVERVIEW_CONTRACT_VERSION,
  SyntheticDocumentContentType,
} from "./index.js";
import type { PointStatus } from "./observation-status.js";

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

/**
 * One indicator the record says is outside, stated the way the source printed it. It is a
 * placement against the document's own bounds, never a grade, a trend, or an interpretation.
 */
export interface ProfileOverviewAttention {
  readonly canonicalCode: string | null;
  /** The name printed in the document, as confirmed. */
  readonly name: string;
  readonly value: string;
  readonly unit: string;
  readonly status: PointStatus;
  /** The bounds as the source printed them, e.g. «0,4 – 4,0»; null when none were printed. */
  readonly range: string | null;
  /** The previous confirmed value of the same indicator, for the change; null when it is the first. */
  readonly previous: { readonly value: string; readonly at: string } | null;
}

/** How one assistant room last answered — the tier it carried, or that the turn was refused. */
export interface ProfileOverviewAssistant {
  readonly assistantId: AssistantId;
  readonly answeredAt: string;
  /** The tier the answer carried; null when the turn was refused. */
  readonly urgency: AssistantUrgencyTier | null;
  /** True when the last turn was refused by the parser or the checker. */
  readonly refused: boolean;
}

/** At most three indicators reach `attention` — the overview names a few, it is not the dossier. */
export const MAX_PROFILE_OVERVIEW_ATTENTION = 3;

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
  /**
   * At most three indicators whose latest confirmed value sits outside, newest reading first —
   * `outsideIndicatorCount` states how many there are, this says which they are.
   */
  readonly attention: readonly ProfileOverviewAttention[];
  /** One entry per assistant room that has ever answered here, newest answer first. */
  readonly assistants: readonly ProfileOverviewAssistant[];
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
