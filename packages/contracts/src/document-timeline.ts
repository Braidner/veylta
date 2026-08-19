import type {
  DOCUMENT_CONTRACT_VERSION,
  DocumentCategory,
  DocumentProcessingStatus,
  SyntheticDocumentContentType,
} from "./index.js";

export const DOCUMENT_TIMELINE_CONTRACT_VERSION = "document-timeline/v1" as const;

/** Days per timeline page: a page is whole days, so `limit` counts days with an entry. */
export const MAX_DOCUMENT_TIMELINE_DAYS = 50;

/** Where a document's effective date comes from: the person's correction, the document, the upload. */
export const DOCUMENT_DATE_SOURCES = ["person", "document", "upload"] as const;
export type DocumentDateSource = (typeof DOCUMENT_DATE_SOURCES)[number];

export interface DocumentEffectiveDate {
  /** A calendar day, `YYYY-MM-DD`. */
  readonly value: string;
  readonly source: DocumentDateSource;
}

/** `PUT …/documents/:documentId/date` — a calendar day, or null to drop the correction. */
export interface DocumentDateRequest {
  readonly documentDate: string | null;
}

export interface DocumentDateResponse {
  readonly contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  readonly documentId: string;
  readonly effectiveDate: DocumentEffectiveDate;
}

export interface DocumentTimelineEntry {
  readonly id: string;
  readonly originalFilename: string;
  readonly contentType: SyntheticDocumentContentType;
  readonly uploadedAt: string;
  readonly effectiveDate: DocumentEffectiveDate;
  readonly category: DocumentCategory | null;
  readonly title: string | null;
  readonly shortSummary: string | null;
  /** Confirmed observations of this document. */
  readonly confirmedCount: number;
  /** Confirmed observations outside their printed range or flagged by the laboratory. */
  readonly outsideRangeCount: number;
  /** Confirmed clinician records of this document. */
  readonly recordCount: number;
}

/**
 * `GET …/documents/timeline?before=<YYYY-MM-DD>&limit=<1..50>`: the `limit` most recent days
 * (strictly before `before`) that carry a reviewed document, with every entry of those days,
 * newest first. `nextBefore` is the oldest returned day, or null when nothing older exists.
 */
export interface DocumentTimelineResponse {
  readonly contractVersion: typeof DOCUMENT_TIMELINE_CONTRACT_VERSION;
  readonly entries: readonly DocumentTimelineEntry[];
  readonly nextBefore: string | null;
}

/**
 * The one queue rule, shared by the timeline query and the web: a document stays in the queue
 * while the machine is not done with it or the person still has a fact to decide.
 *
 * The server states the same rule in SQL — the `NOT EXISTS` clause of `timelineEntriesSql`
 * (`apps/api/src/documents/document-timeline-query.ts`) admits a document exactly when this
 * returns false. The two must move together, or a document would sit in both surfaces or neither.
 */
export function isInDocumentQueue(
  processing: DocumentProcessingStatus,
  pendingFactCount: number,
): boolean {
  return processing.state !== "completed" || pendingFactCount > 0;
}

/** The latest date a person may give a document: tomorrow, in UTC — one rule for 422 and for the field's max. */
export function latestCorrectableDate(now: Date): string {
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return tomorrow.toISOString().slice(0, 10);
}
