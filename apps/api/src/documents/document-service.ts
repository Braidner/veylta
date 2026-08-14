import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CONTRACT_VERSION,
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  DOCUMENT_INTELLIGENCE_RESULT_STATUSES,
  DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES,
  DOCUMENT_LIFECYCLE_CONTRACT_VERSION,
  DOCUMENT_PROCESSING_EVENT_CODES,
  DOCUMENT_SEARCH_CONTRACT_VERSION,
  type DocumentDeleteResponse,
  type DocumentDetail,
  type DocumentFactsResponse,
  type DocumentIntelligenceResult,
  type DocumentIntelligenceStructuredResult,
  type DocumentIntelligenceSummary,
  type DocumentProcessingActivityEvent,
  type DocumentProcessingResponse,
  type DocumentProcessingRestartResponse,
  type DocumentProcessingRetryResponse,
  type DocumentProcessingStatus,
  type DocumentSearchResponse,
  type DocumentSummary,
  type DocumentUploadDisposition,
  type FactReviewCommand,
  type FactReviewOutcome,
  type FactReviewResponse,
  HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION,
  HEALTH_SUMMARY_CONTRACT_VERSION,
  HEALTH_SUMMARY_HISTORY_CONTRACT_VERSION,
  type HealthSummary,
  type HealthSummaryComparisonResponse,
  type HealthSummaryHistoryResponse,
  type HealthSummaryResponse,
  INDICATOR_SERIES_CONTRACT_VERSION,
  type IndicatorCatalogResponse,
  type IndicatorComparison,
  type IndicatorSeriesResponse,
  LAB_EXTRACTION_SCHEMA_VERSION,
  type LabFactReferenceRange,
  type LabFactValidationIssue,
  MAX_DOCUMENT_INTELLIGENCE_STRUCTURED_RESULTS,
  MAX_HEALTH_SUMMARY_EVIDENCE,
  MAX_HEALTH_SUMMARY_HISTORY_PAGE_SIZE,
  MAX_INDICATOR_SERIES_PAGE_SIZE,
  MAX_OBSERVATION_HISTORY_PAGE_SIZE,
  MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS,
  MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS,
  OBJECT_STORAGE_CONTRACT_VERSION,
  OBSERVATION_HISTORY_CONTRACT_VERSION,
  type ObservationHistoryResponse,
  type PatientProfileSummary,
  PROFILE_OVERVIEW_CONTRACT_VERSION,
  type ProfileOverviewResponse,
  SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION,
  SYNTHETIC_INDICATOR_CATALOG,
  SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION,
  type SyntheticDocumentContentType,
  type SyntheticEvidenceBundleManifest,
  type SyntheticProfileExportManifest,
} from "@veylta/contracts";
import type { Database, DatabaseClient, QueryResult } from "../database/pool.js";
import {
  DomainConflictError,
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import { resolveAnalyteMapping } from "../processing/analyte-mapping.js";
import { CODEX_DOCUMENT_INTELLIGENCE_VERSION } from "../processing/codex-document-intelligence-provider.js";
import {
  appendProcessingEventInTransaction,
  enqueueDocumentExtractionInTransaction,
  enqueueDocumentReanalysisInTransaction,
} from "../processing/processing-job-service.js";
import {
  createObjectStorageKey,
  type ObjectMetadata,
  type ObjectStorage,
  ObjectStorageIntegrityError,
  type ObjectStorageKey,
  ObjectStorageSizeLimitError,
  type StagedObjectMetadata,
} from "../storage/object-storage.js";
import { createSyntheticEvidenceBundle } from "./evidence-bundle.js";

export class UnsupportedDocumentTypeError extends Error {}
export class InvalidDocumentSignatureError extends Error {}
export class UploadTooLargeError extends Error {}
export class IdempotencyConflictError extends Error {}
export class ProcessingNotAvailableError extends DomainConflictError {}

export interface StagedDocument {
  metadata: StagedObjectMetadata;
  originalFilename: string;
}

export interface DocumentContent {
  body: Readable;
  byteSize: number;
  contentType: SyntheticDocumentContentType;
  originalFilename: string;
}

export interface EvidenceBundleContent {
  body: Readable;
  byteSize: number;
}

export interface ObservationHistoryQuery {
  canonicalCode?: string;
  limit?: string;
  cursor?: string;
}

export interface HealthSummaryQuery {
  version?: string;
}

export interface HealthSummaryHistoryQuery {
  beforeVersion?: string;
  limit?: string;
}

export interface HealthSummaryComparisonQuery {
  fromVersion: string;
  toVersion: string;
}

export interface IndicatorSeriesQuery {
  unit: string;
  limit?: string;
  cursor?: string;
}

export interface DocumentSearchQuery {
  q: string;
  limit?: string;
}

export interface DocumentUploadAcceptance {
  readonly disposition: DocumentUploadDisposition;
  readonly document: DocumentSummary;
}

export interface DocumentService {
  acceptUpload(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    staged: StagedDocument,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<DocumentUploadAcceptance>;
  discardStaged(staged: StagedDocument): Promise<void>;
  getContent(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    correlationId: string,
  ): Promise<DocumentContent>;
  getEvidenceBundle(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    correlationId: string,
  ): Promise<EvidenceBundleContent>;
  getPortableProfileExport(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    correlationId: string,
  ): Promise<EvidenceBundleContent>;
  getDocument(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    correlationId: string,
  ): Promise<DocumentDetail>;
  searchDocuments(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    query: DocumentSearchQuery,
    correlationId: string,
  ): Promise<DocumentSearchResponse>;
  deleteDocument(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<{ response: DocumentDeleteResponse; replayed: boolean }>;
  getProcessing(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    correlationId: string,
  ): Promise<DocumentProcessingResponse>;
  getFacts(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    correlationId: string,
  ): Promise<DocumentFactsResponse>;
  getObservationHistory(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    query: ObservationHistoryQuery,
    correlationId: string,
  ): Promise<ObservationHistoryResponse>;
  getProfileOverview(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    correlationId: string,
  ): Promise<ProfileOverviewResponse>;
  getHealthSummary(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    query: HealthSummaryQuery,
    correlationId: string,
  ): Promise<HealthSummaryResponse>;
  getHealthSummaryHistory(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    query: HealthSummaryHistoryQuery,
    correlationId: string,
  ): Promise<HealthSummaryHistoryResponse>;
  getHealthSummaryComparison(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    query: HealthSummaryComparisonQuery,
    correlationId: string,
  ): Promise<HealthSummaryComparisonResponse>;
  getIndicatorCatalog(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    correlationId: string,
  ): Promise<IndicatorCatalogResponse>;
  getIndicatorSeries(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; canonicalCode: string },
    query: IndicatorSeriesQuery,
    correlationId: string,
  ): Promise<IndicatorSeriesResponse>;
  reviewFact(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string; factId: string },
    command: FactReviewCommand,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<{ response: FactReviewResponse; replayed: boolean }>;
  retryProcessing(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<DocumentProcessingRetryResponse>;
  restartProcessing(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<DocumentProcessingRestartResponse>;
  requireProfileWriteAccess(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
  ): Promise<void>;
  stageDocument(input: {
    body: Readable;
    contentType: string;
    filename: string | undefined;
  }): Promise<StagedDocument>;
}

export interface DocumentServiceOptions {
  maxDocumentBytes: number;
}

interface ProfileArchiveOptions {
  contractVersion:
    | typeof SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION
    | typeof SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION;
  action: "profile.evidence_bundle.exported" | "profile.portable_export.exported";
  maximumDocuments: number;
  failWhenOverLimit: boolean;
}

interface Queryable {
  query<T extends object>(queryText: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface DocumentRow {
  id: string;
  family_id: string;
  patient_profile_id: string;
  status: "uploaded";
  original_filename: string;
  uploaded_at: string;
  duplicate_of_document_id: string | null;
  duplicate_profile_id: string | null;
  content_type: SyntheticDocumentContentType;
  byte_size: number;
  sha256: string;
  storage_key: string;
  document_version_id: string;
}

interface ProcessingJobRow {
  id: string;
  state: string;
  current_stage: string | null;
  last_error_code: string | null;
  updated_at: string;
}

interface ProcessingCountsRow {
  status: string;
  extraction_run_id: string;
  fact_count: number;
  needs_review_count: number;
}

interface ProcessingEventRow {
  code: string;
  attempt: number;
  occurred_at: string;
}

interface FactRow {
  id: string;
  document_version_id: string;
  page_number: number;
  fact_key: string;
  source_fragment: string;
  source_name: string;
  source_value: string;
  source_unit: string;
  proposed_canonical_code: string | null;
  proposed_normalized_value: string | null;
  proposed_normalized_unit: string | null;
  proposed_reference_range: string | null;
  proposed_specimen: string | null;
  proposed_sampled_at: string | null;
  proposed_resulted_at: string | null;
  proposed_laboratory: string | null;
  confidence: number;
  validation_issues: string;
  review_status: string;
  review_id: string | null;
  decision_outcome: string | null;
  review_decided_at: string | null;
  review_decided_by_user_id: string | null;
  review_decided_by_display_name: string | null;
  review_observation_id: string | null;
  corrected_source_name: string | null;
  corrected_source_value: string | null;
  corrected_source_unit: string | null;
  canonical_display_name: string | null;
}

interface FactForReviewRow {
  id: string;
  document_version_id: string;
  document_page_id: string;
  extraction_run_id: string;
  source_fragment: string;
  source_name: string;
  source_value: string;
  source_unit: string;
  proposed_canonical_code: string | null;
  proposed_normalized_value: string | null;
  proposed_normalized_unit: string | null;
  proposed_reference_range: string | null;
  proposed_specimen: string | null;
  proposed_sampled_at: string | null;
  proposed_resulted_at: string | null;
  proposed_laboratory: string | null;
  confidence: number;
}

interface ReviewRequestRow {
  extracted_fact_id: string;
  request_hash: string;
  decision_id: string;
  source_fact_version: number;
  outcome: string;
  decided_at: string;
  decided_by_user_id: string;
  decided_by_display_name: string;
  observation_id: string | null;
}

interface ReviewDecisionRow {
  id: string;
  extracted_fact_id: string;
  source_fact_version: number;
  outcome: string;
  decided_at: string;
  decided_by_user_id: string;
  decided_by_display_name: string;
  observation_id: string | null;
}

interface ExtractionRunForFactsRow {
  id: string;
  extractor_version: string;
  status: string;
}

interface ObservationHistoryRow {
  id: string;
  canonical_code: string | null;
  source_name: string;
  source_value: string;
  source_unit: string;
  normalized_value: string | null;
  normalized_unit: string | null;
  conversion_version: string | null;
  sampled_at: string | null;
  resulted_at: string | null;
  uploaded_at: string;
  specimen_type: string | null;
  laboratory: string | null;
  source_fragment: string;
  extraction_confidence: number;
  confirmed_at: string;
  confirmed_by_user_id: string;
  confirmed_by_display_name: string;
  document_id: string;
  document_version_id: string;
  page_number: number;
  timeline_at: string;
  reference_source_text: string | null;
  reference_source_low: string | null;
  reference_source_high: string | null;
  reference_source_unit: string | null;
  reference_laboratory_out_of_range: number | null;
  reference_normalized_low: string | null;
  reference_normalized_high: string | null;
  reference_normalized_unit: string | null;
  reference_conversion_version: string | null;
}

interface ObservationHistoryCursor {
  canonicalCode: string | null;
  id: string;
  timelineAt: string;
}

interface IndicatorCatalogRow {
  canonical_code: string;
  comparison_unit: string;
  comparison_value: string;
  display_name: string;
  timeline_at: string;
  id: string;
}

interface IndicatorSeriesCursor {
  canonicalCode: string;
  unit: string;
  id: string;
  timelineAt: string;
  confirmedAt: string;
}

interface ProfileOverviewDocumentRow extends DocumentRow {
  job_id: string | null;
  job_state: string | null;
  job_current_stage: string | null;
  job_last_error_code: string | null;
  job_updated_at: string | null;
  extraction_run_id: string | null;
  extraction_status: string | null;
  fact_count: number | null;
  pending_fact_count: number | null;
  needs_attention_fact_count: number | null;
  intelligence_provider: string | null;
  intelligence_model_id: string | null;
  intelligence_runtime_version: string | null;
  intelligence_schema_version: string | null;
  intelligence_category: string | null;
  intelligence_title: string | null;
  intelligence_short_summary: string | null;
  intelligence_document_date: string | null;
  intelligence_confidence: number | null;
}

interface DocumentIntelligenceSummaryRow {
  provider: string;
  model_id: string;
  runtime_version: string;
  schema_version: string;
  category: string;
  title: string;
  short_summary: string;
  document_date: string | null;
  confidence: number;
}

interface DocumentIntelligenceRow extends DocumentIntelligenceSummaryRow {
  detailed_summary: string;
  structured_results_json: string;
}

interface ProfileOverviewProfileRow {
  id: string;
  family_id: string;
  display_name: string;
  kind: string;
  access: string;
  created_at: string;
}

interface ProfileOverviewQueueRow {
  document_count: number;
  pending_fact_count: number;
  needs_attention_fact_count: number;
}

interface EvidenceBundleProfileRow {
  id: string;
  family_id: string;
  display_name: string;
  kind: string;
  created_at: string;
}

interface EvidenceBundleDocumentRow extends DocumentRow {}

interface HealthSummaryRow {
  id: string;
  summary_id: string;
  version: number;
  created_at: string;
  previous_summary_id: string | null;
  previous_version: number | null;
  previous_created_at: string | null;
  included_evidence_count: number;
  available_confirmed_observation_count: number;
  missing_data: string;
  recommendation_codes: string;
  observation_id: string;
  position: number;
  is_new_since_previous_summary: number;
  canonical_code: string | null;
  source_name: string;
  source_value: string;
  source_unit: string;
  normalized_value: string | null;
  normalized_unit: string | null;
  conversion_version: string | null;
  sampled_at: string | null;
  resulted_at: string | null;
  uploaded_at: string;
  specimen_type: string | null;
  laboratory: string | null;
  source_fragment: string;
  extraction_confidence: number;
  confirmed_at: string;
  confirmed_by_user_id: string;
  confirmed_by_display_name: string;
  document_id: string;
  document_version_id: string;
  page_number: number;
  timeline_at: string;
  reference_source_text: string | null;
  reference_source_low: string | null;
  reference_source_high: string | null;
  reference_source_unit: string | null;
  reference_laboratory_out_of_range: number | null;
  reference_normalized_low: string | null;
  reference_normalized_high: string | null;
  reference_normalized_unit: string | null;
  reference_conversion_version: string | null;
}

interface HealthSummaryVersionRow {
  id: string;
  version: number;
  created_at: string;
  included_evidence_count: number;
  available_confirmed_observation_count: number;
  actual_evidence_count: number;
  new_evidence_count: number;
}

interface HealthSummarySelectorRow {
  id: string;
  version: number;
  created_at: string;
  included_evidence_count: number;
}

interface RetryRequestRow {
  document_version_id: string;
  created_at: string;
}

interface UploadRequestRow {
  document_id: string;
  patient_profile_id: string;
  request_byte_size: number;
  request_content_type: string;
  request_sha256: string;
}

interface DeleteRequestRow {
  document_id: string;
  patient_profile_id: string;
  deleted_at: string;
}

interface BlobRow {
  id: string;
  storage_key: string;
  content_type: SyntheticDocumentContentType;
  byte_size: number;
  sha256: string;
}

const pdfSignature = Buffer.from("%PDF-");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpegSignature = Buffer.from([255, 216, 255]);

const syntheticDocumentContentTypes = new Set<SyntheticDocumentContentType>([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function finalObjectKey(familyId: string, checksum: string): ObjectStorageKey {
  return createObjectStorageKey(`family_${familyId}/sha256_${checksum}`);
}

function stagingObjectKey(): ObjectStorageKey {
  return createObjectStorageKey(`staging/upload_${randomUUID()}`);
}

function canonicalProfileScope(scope: { familyId: string; profileId: string }) {
  return {
    familyId: scope.familyId.toLowerCase(),
    profileId: scope.profileId.toLowerCase(),
  };
}

function canonicalDocumentScope(scope: {
  familyId: string;
  profileId: string;
  documentId: string;
}) {
  return {
    ...canonicalProfileScope(scope),
    documentId: scope.documentId.toLowerCase(),
  };
}

function canonicalFactScope(scope: {
  familyId: string;
  profileId: string;
  documentId: string;
  factId: string;
}) {
  return {
    ...canonicalDocumentScope(scope),
    factId: scope.factId.toLowerCase(),
  };
}

const canonicalCodePattern = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const historyCursorPattern = /^[A-Za-z0-9_-]{1,500}$/;
const defaultObservationHistoryPageSize = 50;
const defaultIndicatorSeriesPageSize = 100;
const defaultDocumentSearchPageSize = 20;
const maximumDocumentSearchPageSize = 50;
const syntheticIndicatorCatalog: ReadonlySet<string> = new Set(
  SYNTHETIC_INDICATOR_CATALOG.map((indicator) => indicator.canonicalCode),
);

function historyCanonicalCode(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!canonicalCodePattern.test(value)) throw new DomainValidationError();
  return value;
}

function documentSearchQuery(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    [...normalized].length < 2 ||
    [...normalized].length > 120 ||
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  ) {
    throw new DomainValidationError();
  }
  return normalized;
}

function documentSearchLimit(value: string | undefined): number {
  if (value === undefined) return defaultDocumentSearchPageSize;
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) throw new DomainValidationError();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumDocumentSearchPageSize) {
    throw new DomainValidationError();
  }
  return limit;
}

function observationHistoryLimit(value: string | undefined): number {
  if (value === undefined) return defaultObservationHistoryPageSize;
  if (!/^(?:[1-9][0-9]?|100)$/.test(value)) throw new DomainValidationError();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_OBSERVATION_HISTORY_PAGE_SIZE) {
    throw new DomainValidationError();
  }
  return limit;
}

function indicatorSeriesLimit(value: string | undefined): number {
  if (value === undefined) return defaultIndicatorSeriesPageSize;
  if (!/^(?:[1-9][0-9]?|100)$/.test(value)) throw new DomainValidationError();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_INDICATOR_SERIES_PAGE_SIZE) {
    throw new DomainValidationError();
  }
  return limit;
}

function healthSummaryVersion(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^[1-9][0-9]{0,8}$/.test(value)) throw new DomainValidationError();
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throw new DomainValidationError();
  return version;
}

function healthSummaryHistoryLimit(value: string | undefined): number {
  if (value === undefined) return 25;
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) throw new DomainValidationError();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HEALTH_SUMMARY_HISTORY_PAGE_SIZE) {
    throw new DomainValidationError();
  }
  return limit;
}

function healthSummaryComparisonVersions(query: HealthSummaryComparisonQuery): {
  fromVersion: number;
  toVersion: number;
} {
  const fromVersion = healthSummaryVersion(query.fromVersion);
  const toVersion = healthSummaryVersion(query.toVersion);
  if (fromVersion === null || toVersion === null || fromVersion >= toVersion) {
    throw new DomainValidationError();
  }
  return { fromVersion, toVersion };
}

function indicatorUnit(value: string): string {
  if (
    value.length === 0 ||
    value.length > 100 ||
    value !== value.trim() ||
    value.includes("|") ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    throw new DomainValidationError();
  }
  return value;
}

function cursorTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new DomainValidationError();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new DomainValidationError();
  }
  return value;
}

function decodeObservationHistoryCursor(
  value: string | undefined,
  canonicalCode: string | null,
): ObservationHistoryCursor | null {
  if (value === undefined) return null;
  if (!historyCursorPattern.test(value)) throw new DomainValidationError();
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error("Non-canonical cursor");
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid cursor object");
    }
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.join(",") !== "c,id,t,v" || record.v !== 1) {
      throw new Error("Invalid cursor shape");
    }
    if (record.c !== canonicalCode || typeof record.id !== "string") {
      throw new Error("Cursor query mismatch");
    }
    if (!canonicalUuidPattern.test(record.id)) throw new Error("Invalid cursor id");
    return { canonicalCode, id: record.id, timelineAt: cursorTimestamp(record.t) };
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    throw new DomainValidationError();
  }
}

function encodeObservationHistoryCursor(cursor: ObservationHistoryCursor): string {
  return Buffer.from(
    JSON.stringify({ v: 1, t: cursor.timelineAt, id: cursor.id, c: cursor.canonicalCode }),
    "utf8",
  ).toString("base64url");
}

function decodeIndicatorSeriesCursor(
  value: string | undefined,
  canonicalCode: string,
  unit: string,
): IndicatorSeriesCursor | null {
  if (value === undefined) return null;
  if (!historyCursorPattern.test(value)) throw new DomainValidationError();
  try {
    const decoded = Buffer.from(value, "base64url");
    if (decoded.toString("base64url") !== value) throw new Error("Non-canonical cursor");
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid cursor object");
    }
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "c,ca,id,t,u,v" || record.v !== 2) {
      throw new Error("Invalid cursor shape");
    }
    if (record.c !== canonicalCode || record.u !== unit || typeof record.id !== "string") {
      throw new Error("Cursor query mismatch");
    }
    if (!canonicalUuidPattern.test(record.id)) throw new Error("Invalid cursor id");
    return {
      canonicalCode,
      unit,
      id: record.id,
      timelineAt: cursorTimestamp(record.t),
      confirmedAt: cursorTimestamp(record.ca),
    };
  } catch (error) {
    if (error instanceof DomainValidationError) throw error;
    throw new DomainValidationError();
  }
}

function encodeIndicatorSeriesCursor(cursor: IndicatorSeriesCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 2,
      t: cursor.timelineAt,
      ca: cursor.confirmedAt,
      id: cursor.id,
      c: cursor.canonicalCode,
      u: cursor.unit,
    }),
    "utf8",
  ).toString("base64url");
}

interface ParsedDecimal {
  readonly unscaled: bigint;
  readonly scale: number;
}

function parseSourceDecimal(value: string): ParsedDecimal | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const integer = match[2] ?? "";
  const fraction = match[3] ?? "";
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, "");
  return { unscaled: sign * BigInt(digits.length === 0 ? "0" : digits), scale: fraction.length };
}

function decimalDelta(
  current: string,
  previous: string,
): Extract<IndicatorComparison, { state: "available" }>["delta"] | null {
  const currentDecimal = parseSourceDecimal(current);
  const previousDecimal = parseSourceDecimal(previous);
  if (currentDecimal === null || previousDecimal === null) return null;
  const scale = Math.max(currentDecimal.scale, previousDecimal.scale);
  const currentUnscaled = currentDecimal.unscaled * 10n ** BigInt(scale - currentDecimal.scale);
  const previousUnscaled = previousDecimal.unscaled * 10n ** BigInt(scale - previousDecimal.scale);
  const signedDelta = currentUnscaled - previousUnscaled;
  const magnitude = signedDelta < 0n ? -signedDelta : signedDelta;
  const digits = magnitude.toString().padStart(scale + 1, "0");
  const formatted =
    scale === 0
      ? digits
      : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "");
  return {
    value: formatted === "" ? "0" : formatted,
    direction: signedDelta > 0n ? "increased" : signedDelta < 0n ? "decreased" : "unchanged",
  };
}

function safeFilename(
  value: string | undefined,
  contentType: SyntheticDocumentContentType,
): string {
  const leaf = (value ?? "").split(/[\\/]/).at(-1) ?? "";
  const cleaned = [...leaf]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  const bounded = [...cleaned].slice(0, 255).join("");
  if (bounded.length > 0) return bounded;
  return contentType === "application/pdf"
    ? "document.pdf"
    : contentType === "image/png"
      ? "document.png"
      : "document.jpg";
}

function byteSize(value: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ObjectStorageIntegrityError("Database object size is invalid");
  }
  return parsed;
}

function canonicalTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new ObjectStorageIntegrityError("Stored processing timestamp is invalid");
  }
  return value;
}

function asCount(value: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  }
  return parsed;
}

function processingFailureCategory(
  code: string | null,
): Extract<DocumentProcessingStatus, { state: "failed" }>["category"] {
  switch (code) {
    case "DOCUMENT_UNAVAILABLE":
      return "document_unavailable";
    case "INVALID_DOCUMENT":
      return "invalid_document";
    case "AGENT_UNAVAILABLE":
      return "agent_unavailable";
    case "AGENT_OUTPUT_INVALID":
      return "agent_output_invalid";
    case "EXTRACTION_FAILED":
      return "extraction_failed";
    case "VALIDATION_FAILED":
      return "validation_failed";
    case "ATTEMPT_LIMIT":
      return "attempts_exhausted";
    default:
      return "extraction_failed";
  }
}

function processingStatus(
  job: ProcessingJobRow | undefined,
  counts: ProcessingCountsRow | undefined,
): DocumentProcessingStatus {
  if (job === undefined) return { state: "not_started" };
  const updatedAt = canonicalTimestamp(job.updated_at);
  switch (job.state) {
    case "pending":
    case "retry_wait":
      return { state: "queued", updatedAt };
    case "leased":
      if (
        job.current_stage !== "security_check" &&
        job.current_stage !== "text_extraction" &&
        job.current_stage !== "document_classification" &&
        job.current_stage !== "structured_extraction" &&
        job.current_stage !== "validation"
      ) {
        throw new ObjectStorageIntegrityError("Stored processing stage is invalid");
      }
      return { state: job.current_stage, updatedAt };
    case "succeeded": {
      if (
        counts === undefined ||
        (counts.status !== "awaiting_review" && counts.status !== "completed")
      ) {
        throw new ObjectStorageIntegrityError("Stored extraction result is unavailable");
      }
      const factCount = asCount(counts.fact_count, "fact count");
      const needsReviewCount = asCount(counts.needs_review_count, "review count");
      if (needsReviewCount > factCount) {
        throw new ObjectStorageIntegrityError("Stored extraction review count is invalid");
      }
      return counts.status === "awaiting_review"
        ? { state: "awaiting_review", updatedAt, factCount, needsReviewCount }
        : { state: "completed", updatedAt, factCount };
    }
    case "dead_letter":
      return {
        state: "failed",
        updatedAt,
        category: processingFailureCategory(job.last_error_code),
        retryAllowed: true,
      };
    default:
      throw new ObjectStorageIntegrityError("Stored processing state is invalid");
  }
}

function profileOverviewProcessing(row: ProfileOverviewDocumentRow): DocumentProcessingStatus {
  if (row.job_id === null || row.job_state === null || row.job_updated_at === null) {
    return { state: "not_started" };
  }
  const job: ProcessingJobRow = {
    id: requiredBoundedString(row.job_id, 200, "overview processing job"),
    state: row.job_state,
    current_stage: row.job_current_stage,
    last_error_code: row.job_last_error_code,
    updated_at: row.job_updated_at,
  };
  const counts =
    row.extraction_run_id === null ||
    row.extraction_status === null ||
    row.fact_count === null ||
    row.needs_attention_fact_count === null
      ? undefined
      : ({
          extraction_run_id: requiredBoundedString(
            row.extraction_run_id,
            200,
            "overview extraction run",
          ),
          status: row.extraction_status,
          fact_count: row.fact_count,
          needs_review_count: row.needs_attention_fact_count,
        } satisfies ProcessingCountsRow);
  return processingStatus(job, counts);
}

function documentIntelligenceSummary(
  row: DocumentIntelligenceSummaryRow | undefined,
): DocumentIntelligenceSummary | null {
  if (row === undefined) return null;
  const confidence = Number(row.confidence);
  if (
    row.provider !== "codex" ||
    (row.schema_version !== "document-intelligence/v1" &&
      row.schema_version !== DOCUMENT_INTELLIGENCE_CONTRACT_VERSION) ||
    !DOCUMENT_CATEGORIES.includes(row.category as (typeof DOCUMENT_CATEGORIES)[number]) ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    (row.document_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(row.document_date))
  ) {
    throw new ObjectStorageIntegrityError("Stored document intelligence is invalid");
  }
  return {
    contractVersion: DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
    provider: "codex",
    modelId: requiredBoundedString(row.model_id, 100, "document intelligence model"),
    runtimeVersion: requiredBoundedString(
      row.runtime_version,
      100,
      "document intelligence runtime",
    ),
    category: row.category as (typeof DOCUMENT_CATEGORIES)[number],
    title: requiredBoundedString(row.title, 200, "document intelligence title"),
    shortSummary: requiredBoundedString(
      row.short_summary,
      500,
      "document intelligence short summary",
    ),
    documentDate: row.document_date,
    confidence,
  };
}

function documentIntelligenceStructuredResults(
  encoded: string,
): readonly DocumentIntelligenceStructuredResult[] {
  const parsed = parseStoredObject<unknown>(encoded, "document intelligence structured results");
  if (!Array.isArray(parsed) || parsed.length > MAX_DOCUMENT_INTELLIGENCE_STRUCTURED_RESULTS) {
    throw new ObjectStorageIntegrityError(
      "Stored document intelligence structured results is invalid",
    );
  }
  const allowedTypes = new Set<string>(DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES);
  const allowedStatuses = new Set<string>(DOCUMENT_INTELLIGENCE_RESULT_STATUSES);
  const resultKeys = new Set<string>();
  return parsed.map((value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ObjectStorageIntegrityError(
        "Stored document intelligence structured result is invalid",
      );
    }
    const result = value as Record<string, unknown>;
    const resultKey = requiredBoundedString(
      result.resultKey,
      100,
      "document intelligence result key",
    );
    const type = result.type;
    const confidence = Number(result.confidence);
    const status = result.status;
    const source = result.source;
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resultKey) ||
      resultKeys.has(resultKey) ||
      typeof type !== "string" ||
      !allowedTypes.has(type) ||
      typeof status !== "string" ||
      !allowedStatuses.has(status) ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1 ||
      typeof source !== "object" ||
      source === null ||
      Array.isArray(source)
    ) {
      throw new ObjectStorageIntegrityError(
        "Stored document intelligence structured result is invalid",
      );
    }
    resultKeys.add(resultKey);
    const sourceRecord = source as Record<string, unknown>;
    const pageNumber = Number(sourceRecord.pageNumber);
    const fragment = requiredBoundedString(
      sourceRecord.fragment,
      2_000,
      "document intelligence result source fragment",
    );
    const date = nullableBoundedString(result.date, 10, "document intelligence result date");
    if (
      !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > 10_000 ||
      fragment.length < 12 ||
      (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    ) {
      throw new ObjectStorageIntegrityError(
        "Stored document intelligence structured result is invalid",
      );
    }
    return {
      resultKey,
      type: type as DocumentIntelligenceStructuredResult["type"],
      label: requiredBoundedString(result.label, 200, "document intelligence result label"),
      value: nullableBoundedString(result.value, 500, "document intelligence result value"),
      unit: nullableBoundedString(result.unit, 100, "document intelligence result unit"),
      code: nullableBoundedString(result.code, 100, "document intelligence result code"),
      lab: nullableBoundedString(result.lab, 200, "document intelligence result lab"),
      specimen: nullableBoundedString(
        result.specimen,
        200,
        "document intelligence result specimen",
      ),
      date,
      status: status as DocumentIntelligenceStructuredResult["status"],
      confidence,
      source: { pageNumber, fragment },
    };
  });
}

function documentIntelligenceDetail(
  row: DocumentIntelligenceRow | undefined,
): DocumentIntelligenceResult | null {
  const intelligence = documentIntelligenceSummary(row);
  if (intelligence === null || row === undefined) return null;
  return {
    ...intelligence,
    detailedSummary: requiredBoundedString(
      row.detailed_summary,
      4_000,
      "document intelligence detailed summary",
    ),
    structuredResults: documentIntelligenceStructuredResults(row.structured_results_json),
  };
}

function profileOverviewIntelligence(
  row: ProfileOverviewDocumentRow,
): DocumentIntelligenceSummary | null {
  const values = [
    row.intelligence_provider,
    row.intelligence_model_id,
    row.intelligence_runtime_version,
    row.intelligence_schema_version,
    row.intelligence_category,
    row.intelligence_title,
    row.intelligence_short_summary,
    row.intelligence_confidence,
  ];
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) {
    throw new ObjectStorageIntegrityError("Stored document intelligence is incomplete");
  }
  return documentIntelligenceSummary({
    provider: row.intelligence_provider as string,
    model_id: row.intelligence_model_id as string,
    runtime_version: row.intelligence_runtime_version as string,
    schema_version: row.intelligence_schema_version as string,
    category: row.intelligence_category as string,
    title: row.intelligence_title as string,
    short_summary: row.intelligence_short_summary as string,
    document_date: row.intelligence_document_date,
    confidence: row.intelligence_confidence as number,
  });
}

function profileOverviewProfile(row: ProfileOverviewProfileRow): PatientProfileSummary {
  if (row.kind !== "adult" && row.kind !== "dependent") {
    throw new ObjectStorageIntegrityError("Stored profile kind is invalid");
  }
  if (row.access !== "owner" && row.access !== "self" && row.access !== "granted_read") {
    throw new ObjectStorageIntegrityError("Stored profile access is invalid");
  }
  return {
    id: requiredCanonicalUuid(row.id, "overview profile"),
    familyId: requiredCanonicalUuid(row.family_id, "overview family"),
    displayName: requiredBoundedString(row.display_name, 120, "overview profile name"),
    kind: row.kind,
    access: row.access,
    createdAt: canonicalTimestamp(row.created_at),
  };
}

function profileOverviewDocument(
  row: ProfileOverviewDocumentRow,
): ProfileOverviewResponse["recentDocuments"][number] {
  const document = summary(row, profileOverviewProcessing(row), profileOverviewIntelligence(row));
  return {
    id: document.id,
    originalFilename: document.originalFilename,
    contentType: document.contentType,
    uploadedAt: document.uploadedAt,
    processing: document.processing,
    intelligence: document.intelligence,
  };
}

function profileOverviewReviewDocument(
  row: ProfileOverviewDocumentRow,
): ProfileOverviewResponse["reviewQueue"]["documents"][number] {
  const pendingFactCount = asCount(row.pending_fact_count ?? -1, "overview pending fact count");
  const needsAttentionFactCount = asCount(
    row.needs_attention_fact_count ?? -1,
    "overview attention fact count",
  );
  if (needsAttentionFactCount > pendingFactCount) {
    throw new ObjectStorageIntegrityError("Stored overview attention count is invalid");
  }
  const document = summary(row, profileOverviewProcessing(row));
  return {
    id: document.id,
    originalFilename: document.originalFilename,
    contentType: document.contentType,
    uploadedAt: document.uploadedAt,
    pendingFactCount,
    needsAttentionFactCount,
  };
}

function evidenceBundleProfile(
  row: EvidenceBundleProfileRow,
): SyntheticEvidenceBundleManifest["profile"] {
  if (row.kind !== "adult" && row.kind !== "dependent") {
    throw new ObjectStorageIntegrityError("Stored export profile kind is invalid");
  }
  return {
    id: requiredCanonicalUuid(row.id, "export profile"),
    familyId: requiredCanonicalUuid(row.family_id, "export family"),
    displayName: requiredBoundedString(row.display_name, 120, "export profile name"),
    kind: row.kind,
    createdAt: canonicalTimestamp(row.created_at),
  };
}

function evidenceBundleExtension(contentType: SyntheticDocumentContentType): "pdf" | "png" | "jpg" {
  switch (contentType) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
  }
}

function evidenceBundleDocument(
  row: EvidenceBundleDocumentRow,
): SyntheticEvidenceBundleManifest["documents"][number] {
  const id = requiredCanonicalUuid(row.id, "export document");
  return {
    id,
    versionId: requiredCanonicalUuid(row.document_version_id, "export document version"),
    originalFilename: requiredBoundedString(row.original_filename, 255, "export filename"),
    contentType: row.content_type,
    byteSize: byteSize(row.byte_size),
    sha256: canonicalChecksum(row.sha256, "export checksum"),
    uploadedAt: canonicalTimestamp(row.uploaded_at),
    archivePath: `documents/${id}.${evidenceBundleExtension(row.content_type)}`,
  };
}

function summary(
  row: DocumentRow,
  processing: DocumentProcessingStatus = { state: "not_started" },
  intelligence: DocumentIntelligenceSummary | null = null,
): DocumentSummary {
  return {
    id: row.id,
    familyId: row.family_id,
    profileId: row.patient_profile_id,
    status: row.status,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    byteSize: byteSize(row.byte_size),
    sha256: row.sha256,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    duplicate: {
      possible: row.duplicate_of_document_id !== null,
      documentId: row.duplicate_of_document_id,
      profileId: row.duplicate_profile_id,
    },
    processing,
    intelligence,
  };
}

async function intelligenceSummaryForDocument(
  client: Queryable,
  row: DocumentRow,
): Promise<DocumentIntelligenceSummary | null> {
  const stored = (
    await client.query<DocumentIntelligenceSummaryRow>(
      `SELECT provider, model_id, runtime_version, schema_version, category,
              title, short_summary, document_date, confidence
         FROM document_intelligence_results
        WHERE family_id = $1 AND document_version_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [row.family_id, row.document_version_id],
    )
  ).rows[0];
  return documentIntelligenceSummary(stored);
}

async function intelligenceDetailForDocument(
  client: Queryable,
  row: DocumentRow,
): Promise<DocumentIntelligenceResult | null> {
  const stored = (
    await client.query<DocumentIntelligenceRow>(
      `SELECT provider, model_id, runtime_version, schema_version, category,
              title, short_summary, detailed_summary, structured_results_json,
              document_date, confidence
         FROM document_intelligence_results
        WHERE family_id = $1 AND document_version_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [row.family_id, row.document_version_id],
    )
  ).rows[0];
  return documentIntelligenceDetail(stored);
}

function metadataMatches(
  metadata: ObjectMetadata,
  expected: Pick<StagedObjectMetadata, "byteSize" | "contentType" | "sha256">,
): boolean {
  return (
    metadata.contractVersion === OBJECT_STORAGE_CONTRACT_VERSION &&
    metadata.contentType === expected.contentType &&
    metadata.byteSize === expected.byteSize &&
    metadata.sha256 === expected.sha256
  );
}

function documentContentType(value: string): SyntheticDocumentContentType | null {
  const normalized = value.toLowerCase();
  return syntheticDocumentContentTypes.has(normalized as SyntheticDocumentContentType)
    ? (normalized as SyntheticDocumentContentType)
    : null;
}

function signatureFor(contentType: SyntheticDocumentContentType): Buffer {
  switch (contentType) {
    case "application/pdf":
      return pdfSignature;
    case "image/png":
      return pngSignature;
    case "image/jpeg":
      return jpegSignature;
  }
}

async function* verifiedDocumentBytes(
  body: Readable,
  contentType: SyntheticDocumentContentType,
): AsyncGenerator<Buffer> {
  const signature = signatureFor(contentType);
  let prefix = Buffer.alloc(0);
  let verified = false;

  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (verified) {
      yield bytes;
      continue;
    }
    const needed = signature.byteLength - prefix.byteLength;
    prefix = Buffer.concat([prefix, bytes.subarray(0, needed)]);
    if (prefix.byteLength < signature.byteLength) continue;
    if (!prefix.equals(signature)) {
      body.resume();
      throw new InvalidDocumentSignatureError();
    }
    verified = true;
    yield prefix;
    const remainder = bytes.subarray(needed);
    if (remainder.byteLength > 0) yield remainder;
  }
  if (!verified) throw new InvalidDocumentSignatureError();
}

async function requireProfileReadAccess(
  client: Queryable,
  actor: SessionActor,
  familyId: string,
  profileId: string,
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `SELECT p.id
     FROM patient_profiles p
     JOIN family_memberships m
       ON m.family_id = p.family_id
      AND m.user_id = $3
     WHERE p.family_id = $1
       AND p.id = $2
       AND p.archived_at IS NULL
       AND m.status = 'active'
       AND (
         m.role = 'owner'
         OR (m.role = 'adult_member' AND p.linked_user_id = m.user_id)
         OR (
           m.role IN ('adult_member', 'caregiver')
           AND EXISTS (
             SELECT 1
               FROM profile_consent_grants g
              WHERE g.family_id = p.family_id
                AND g.patient_profile_id = p.id
                AND g.grantee_user_id = m.user_id
                AND g.capability = 'profile.read'
                AND g.revoked_at IS NULL
           )
         )
       )`,
    [familyId, profileId, actor.userId],
  );
  if (result.rows[0] === undefined) throw new ResourceNotFoundError();
}

async function requireProfileWriteAccess(
  client: Queryable,
  actor: SessionActor,
  familyId: string,
  profileId: string,
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `SELECT p.id
       FROM patient_profiles p
       JOIN family_memberships m
         ON m.family_id = p.family_id
        AND m.user_id = $3
       WHERE p.family_id = $1
         AND p.id = $2
         AND p.archived_at IS NULL
         AND m.status = 'active'
         AND (
           m.role = 'owner'
           OR (m.role = 'adult_member' AND p.linked_user_id = m.user_id)
         )`,
    [familyId, profileId, actor.userId],
  );
  if (result.rows[0] === undefined) throw new ResourceNotFoundError();
}

async function audit(
  client: Queryable,
  event: {
    familyId: string;
    actorUserId: string;
    action: string;
    resourceType?: string;
    resourceId: string;
    correlationId: string;
    createdAt: Date;
    contractVersion?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, resource_type, resource_id, result,
        correlation_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'success', $7, $8, $9)`,
    [
      randomUUID(),
      event.familyId,
      event.actorUserId,
      event.action,
      event.resourceType ?? "Document",
      event.resourceId,
      event.correlationId,
      { contractVersion: event.contractVersion ?? DOCUMENT_CONTRACT_VERSION },
      event.createdAt,
    ],
  );
}

async function createHealthSummaryIfNeeded(
  client: Queryable,
  input: {
    familyId: string;
    profileId: string;
    extractionRunId: string;
    actorUserId: string;
    correlationId: string;
    now: Date;
  },
): Promise<void> {
  const finalizedRunHasConfirmedEvidence = await client.query<{ id: string }>(
    `SELECT observation.id
       FROM observations observation
       JOIN extracted_facts fact
         ON fact.family_id = observation.family_id
        AND fact.id = observation.source_extracted_fact_id
      WHERE observation.family_id = $1
        AND fact.extraction_run_id = $2
        AND observation.status = 'confirmed'
      LIMIT 1`,
    [input.familyId, input.extractionRunId],
  );
  if (finalizedRunHasConfirmedEvidence.rows[0] === undefined) return;
  const evidenceRows = await client.query<{
    id: string;
    sampled_at: string | null;
    resulted_at: string | null;
    laboratory: string | null;
    canonical_code: string | null;
  }>(
    `SELECT id, sampled_at, resulted_at, laboratory, canonical_code
       FROM observations
      WHERE family_id = $1 AND patient_profile_id = $2 AND status = 'confirmed'
      ORDER BY COALESCE(sampled_at, resulted_at, uploaded_at) DESC, id DESC
      LIMIT $3`,
    [input.familyId, input.profileId, MAX_HEALTH_SUMMARY_EVIDENCE],
  );
  if (evidenceRows.rows.length === 0) return;

  const total = await client.query<{ count: number }>(
    `SELECT count(*) AS count
       FROM observations
      WHERE family_id = $1 AND patient_profile_id = $2 AND status = 'confirmed'`,
    [input.familyId, input.profileId],
  );
  const totalConfirmedObservationCount = asCount(
    total.rows[0]?.count ?? -1,
    "confirmed observation count",
  );
  const previous = (
    await client.query<{ id: string; version: number }>(
      `SELECT id, version
         FROM health_summaries
        WHERE family_id = $1 AND patient_profile_id = $2
        ORDER BY version DESC
        LIMIT 1`,
      [input.familyId, input.profileId],
    )
  ).rows[0];
  const previousEvidence =
    previous === undefined
      ? new Set<string>()
      : new Set(
          (
            await client.query<{ observation_id: string }>(
              `SELECT observation_id
                 FROM health_summary_evidence
                WHERE family_id = $1 AND health_summary_id = $2`,
              [input.familyId, previous.id],
            )
          ).rows.map((row) =>
            requiredCanonicalUuid(row.observation_id, "previous summary evidence"),
          ),
        );
  const missing = new Set<HealthSummary["missingData"][number]>();
  for (const evidence of evidenceRows.rows) {
    if (evidence.sampled_at === null) missing.add("sample_date");
    if (evidence.resulted_at === null) missing.add("result_date");
    if (evidence.laboratory === null) missing.add("laboratory");
    if (evidence.canonical_code === null) missing.add("canonical_indicator");
  }
  const pendingReview = await client.query<{ count: number }>(
    `SELECT count(DISTINCT r.id) AS count
       FROM extraction_runs r
       JOIN document_versions version
         ON version.family_id = r.family_id AND version.id = r.document_version_id
       JOIN documents document
         ON document.family_id = version.family_id AND document.id = version.document_id
       JOIN extracted_facts fact
         ON fact.family_id = r.family_id AND fact.extraction_run_id = r.id
       LEFT JOIN review_decisions decision
         ON decision.family_id = fact.family_id AND decision.extracted_fact_id = fact.id
      WHERE r.family_id = $1
        AND document.patient_profile_id = $2
        AND document.deleted_at IS NULL
        AND r.status = 'awaiting_review'
        AND r.id = (
          SELECT latest_run.id
            FROM extraction_runs latest_run
           WHERE latest_run.family_id = r.family_id
             AND latest_run.document_version_id = r.document_version_id
           ORDER BY latest_run.created_at DESC, latest_run.id DESC
           LIMIT 1
        )
        AND decision.id IS NULL`,
    [input.familyId, input.profileId],
  );
  const recommendationCodes: HealthSummary["recommendations"][number]["code"][] = [
    "prepare_source_for_clinician",
    ...(asCount(pendingReview.rows[0]?.count ?? -1, "pending review count") > 0
      ? (["complete_pending_review"] as const)
      : []),
  ];
  const now = input.now.toISOString();
  const summaryId = randomUUID();
  const version =
    previous === undefined ? 1 : asCount(previous.version, "previous summary version") + 1;
  await client.query(
    `INSERT INTO health_summaries
       (id, family_id, patient_profile_id, version, previous_summary_id,
        summary_contract_version, included_evidence_count, available_confirmed_observation_count,
        missing_data, recommendation_codes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      summaryId,
      input.familyId,
      input.profileId,
      version,
      previous?.id ?? null,
      HEALTH_SUMMARY_CONTRACT_VERSION,
      evidenceRows.rows.length,
      totalConfirmedObservationCount,
      [...missing].sort(),
      recommendationCodes,
      now,
    ],
  );
  for (const [index, evidence] of evidenceRows.rows.entries()) {
    const observationId = requiredCanonicalUuid(evidence.id, "summary evidence observation");
    await client.query(
      `INSERT INTO health_summary_evidence
         (health_summary_id, family_id, observation_id, position, is_new_since_previous_summary, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        summaryId,
        input.familyId,
        observationId,
        index + 1,
        previousEvidence.has(observationId) ? 0 : 1,
        now,
      ],
    );
  }
  await audit(client, {
    familyId: input.familyId,
    actorUserId: input.actorUserId,
    action: "profile.health_summary.generated",
    resourceType: "HealthSummary",
    resourceId: summaryId,
    correlationId: input.correlationId,
    createdAt: input.now,
    contractVersion: HEALTH_SUMMARY_CONTRACT_VERSION,
  });
}

async function documentRow(
  client: Queryable,
  actor: SessionActor,
  scope: { familyId: string; profileId: string; documentId: string },
  access: "read" | "write" = "read",
): Promise<DocumentRow> {
  const result = await client.query<DocumentRow>(
    `SELECT d.id,
            d.family_id,
            d.patient_profile_id,
            d.status,
            d.original_filename,
            d.uploaded_at,
            duplicate.id AS duplicate_of_document_id,
            duplicate.patient_profile_id AS duplicate_profile_id,
            COALESCE(bt.content_type, b.content_type) AS content_type,
            b.byte_size,
            b.sha256,
            b.storage_key,
            v.id AS document_version_id
     FROM documents d
     JOIN patient_profiles p
       ON p.family_id = d.family_id
      AND p.id = d.patient_profile_id
      AND p.archived_at IS NULL
     JOIN family_memberships m
       ON m.family_id = d.family_id
      AND m.user_id = $4
      AND m.status = 'active'
      AND (
        m.role = 'owner'
        OR (m.role = 'adult_member' AND p.linked_user_id = m.user_id)
        OR (
          $5 = 'read'
          AND m.role IN ('adult_member', 'caregiver')
          AND EXISTS (
            SELECT 1
              FROM profile_consent_grants g
             WHERE g.family_id = d.family_id
               AND g.patient_profile_id = d.patient_profile_id
               AND g.grantee_user_id = m.user_id
               AND g.capability = 'profile.read'
               AND g.revoked_at IS NULL
          )
        )
      )
     JOIN document_versions v
       ON v.family_id = d.family_id
      AND v.document_id = d.id
      AND v.version_number = 1
     JOIN document_blobs b
       ON b.family_id = v.family_id
      AND b.id = v.blob_id
     LEFT JOIN document_blob_content_types bt
       ON bt.family_id = b.family_id
      AND bt.blob_id = b.id
     LEFT JOIN documents duplicate
       ON duplicate.family_id = d.family_id
      AND duplicate.id = d.duplicate_of_document_id
      AND duplicate.deleted_at IS NULL
     WHERE d.family_id = $1
       AND d.patient_profile_id = $2
       AND d.id = $3
       AND d.deleted_at IS NULL`,
    [scope.familyId, scope.profileId, scope.documentId, actor.userId, access],
  );
  const row = result.rows[0];
  if (row === undefined) throw new ResourceNotFoundError();
  return row;
}

async function processingForDocument(
  client: Queryable,
  row: DocumentRow,
): Promise<DocumentProcessingStatus> {
  const jobs = await client.query<ProcessingJobRow>(
    `SELECT id, state, current_stage, last_error_code, updated_at
       FROM processing_jobs
      WHERE family_id = $1 AND document_version_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [row.family_id, row.document_version_id],
  );
  const results = await client.query<ProcessingCountsRow>(
    `SELECT r.status,
            r.id AS extraction_run_id,
            count(f.id) AS fact_count,
            sum(
              CASE
                WHEN f.review_status = 'needs_review' AND d.id IS NULL THEN 1
                ELSE 0
              END
            )
              AS needs_review_count
       FROM extraction_runs r
       LEFT JOIN extracted_facts f
         ON f.family_id = r.family_id
        AND f.extraction_run_id = r.id
       LEFT JOIN review_decisions d
         ON d.family_id = f.family_id
        AND d.extracted_fact_id = f.id
      WHERE r.family_id = $1 AND r.document_version_id = $2
      GROUP BY r.id, r.status
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 1`,
    [row.family_id, row.document_version_id],
  );
  return processingStatus(jobs.rows[0], results.rows[0]);
}

const processingEventCodes = new Set<string>(DOCUMENT_PROCESSING_EVENT_CODES);

async function processingActivityForDocument(
  client: Queryable,
  row: DocumentRow,
): Promise<readonly DocumentProcessingActivityEvent[]> {
  const events = await client.query<ProcessingEventRow>(
    `SELECT e.code, e.attempt, e.occurred_at
       FROM processing_job_events e
      WHERE e.family_id = $1
        AND e.processing_job_id = (
          SELECT id
            FROM processing_jobs
           WHERE family_id = $1 AND document_version_id = $2
           ORDER BY created_at DESC, id DESC
           LIMIT 1
        )
      ORDER BY e.sequence`,
    [row.family_id, row.document_version_id],
  );
  return events.rows.map((event) => {
    const attempt = asCount(event.attempt, "processing activity attempt");
    if (attempt > 100 || !processingEventCodes.has(event.code)) {
      throw new ObjectStorageIntegrityError("Stored processing activity is invalid");
    }
    return {
      code: event.code as DocumentProcessingActivityEvent["code"],
      attempt,
      occurredAt: canonicalTimestamp(event.occurred_at),
    };
  });
}

function parseStoredObject<T>(value: string, label: string): T {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("not an object");
    }
    return parsed as T;
  } catch {
    throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  }
}

function stringArray(value: string, label: string): LabFactValidationIssue[] {
  const parsed: unknown = parseStoredObject<unknown>(value, label);
  const allowed = new Set<LabFactValidationIssue>([
    "LOW_CONFIDENCE",
    "AMBIGUOUS_UNIT",
    "MISSING_UNIT",
    "INVALID_VALUE",
    "INVALID_DATE",
    "INVALID_REFERENCE_RANGE",
    "UNSUPPORTED_ANALYTE",
  ]);
  if (
    !Array.isArray(parsed) ||
    new Set(parsed).size !== parsed.length ||
    parsed.some((entry) => !allowed.has(entry as LabFactValidationIssue))
  ) {
    throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  }
  return parsed as LabFactValidationIssue[];
}

function nullableBoundedString(value: unknown, maximum: number, label: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value !== value.trim()
  ) {
    throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  }
  return value;
}

function requiredBoundedString(value: unknown, maximum: number, label: string): string {
  const parsed = nullableBoundedString(value, maximum, label);
  if (parsed === null) throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  return parsed;
}

function canonicalChecksum(value: unknown, label: string): string {
  const checksum = requiredBoundedString(value, 64, label);
  if (!/^[a-f0-9]{64}$/.test(checksum)) {
    throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  }
  return checksum;
}

function nullableCanonicalTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  }
  return canonicalTimestamp(value);
}

function referenceRange(value: string): LabFactReferenceRange {
  const parsed = parseStoredObject<Record<string, unknown>>(value, "reference range");
  const keys = Object.keys(parsed).sort();
  const expectedKeys = [
    "laboratoryOutOfRange",
    "sourceHigh",
    "sourceLow",
    "sourceText",
    "sourceUnit",
  ];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new ObjectStorageIntegrityError("Stored reference range is invalid");
  }
  const laboratoryOutOfRange = parsed.laboratoryOutOfRange;
  if (laboratoryOutOfRange !== null && typeof laboratoryOutOfRange !== "boolean") {
    throw new ObjectStorageIntegrityError("Stored reference range is invalid");
  }
  return {
    sourceText: nullableBoundedString(parsed.sourceText, 200, "reference range"),
    sourceLow: nullableBoundedString(parsed.sourceLow, 100, "reference range"),
    sourceHigh: nullableBoundedString(parsed.sourceHigh, 100, "reference range"),
    sourceUnit: nullableBoundedString(parsed.sourceUnit, 100, "reference range"),
    laboratoryOutOfRange,
  };
}

interface ValidatedFactReviewCommand {
  factVersion: 1;
  decision: "confirm" | "correct" | "reject";
  correction:
    | {
        sourceName: string;
        sourceValue: string;
        sourceUnit: string;
      }
    | undefined;
}

function reviewText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\r\n]/.test(value)
  ) {
    throw new DomainValidationError();
  }
  return value;
}

function validateFactReviewCommand(command: FactReviewCommand): ValidatedFactReviewCommand {
  if (command.factVersion !== 1) throw new DomainConflictError();
  if (
    command.decision !== "confirm" &&
    command.decision !== "correct" &&
    command.decision !== "reject"
  ) {
    throw new DomainValidationError();
  }
  if (command.decision === "correct") {
    const correction = command.correction;
    if (correction === undefined) throw new DomainValidationError();
    return {
      factVersion: 1,
      decision: "correct",
      correction: {
        sourceName: reviewText(correction.sourceName, 200),
        sourceValue: reviewText(correction.sourceValue, 100),
        sourceUnit: reviewText(correction.sourceUnit, 100),
      },
    };
  }
  if (command.correction !== undefined) throw new DomainValidationError();
  return { factVersion: 1, decision: command.decision, correction: undefined };
}

function reviewRequestHash(factId: string, command: ValidatedFactReviewCommand): string {
  return sha256(
    JSON.stringify({
      factId,
      factVersion: command.factVersion,
      decision: command.decision,
      correction: command.correction ?? null,
    }),
  );
}

function factReviewOutcome(value: string): FactReviewOutcome {
  switch (value) {
    case "confirm":
      return "confirmed";
    case "correct":
      return "corrected";
    case "reject":
      return "rejected";
    default:
      throw new ObjectStorageIntegrityError("Stored fact review outcome is invalid");
  }
}

function factReviewResponse(row: ReviewDecisionRow): FactReviewResponse {
  const outcome = factReviewOutcome(row.outcome);
  const factVersion = Number(row.source_fact_version);
  if (!Number.isSafeInteger(factVersion) || factVersion !== 1) {
    throw new ObjectStorageIntegrityError("Stored fact review version is invalid");
  }
  const observationId = row.observation_id;
  if (
    (outcome === "rejected" && observationId !== null) ||
    (outcome !== "rejected" && observationId === null)
  ) {
    throw new ObjectStorageIntegrityError("Stored fact review observation is invalid");
  }
  return {
    contractVersion: DOCUMENT_CONTRACT_VERSION,
    review: {
      id: requiredBoundedString(row.id, 200, "fact review id"),
      factId: requiredBoundedString(row.extracted_fact_id, 200, "fact review fact"),
      factVersion,
      outcome,
      decidedAt: canonicalTimestamp(row.decided_at),
      decidedBy: {
        id: requiredBoundedString(row.decided_by_user_id, 200, "fact review actor"),
        displayName: requiredBoundedString(
          row.decided_by_display_name,
          120,
          "fact review actor display name",
        ),
      },
      observationId:
        observationId === null
          ? null
          : requiredBoundedString(observationId, 200, "fact review observation"),
    },
  };
}

function derivedReviewStatus(
  rawStatus: string,
  decisionOutcome: string | null,
): Extract<
  DocumentFactsResponse["items"][number]["reviewStatus"],
  "extracted" | "needs_review" | "confirmed" | "rejected"
> {
  if (decisionOutcome === "confirm" || decisionOutcome === "correct") return "confirmed";
  if (decisionOutcome === "reject") return "rejected";
  if (decisionOutcome !== null) {
    throw new ObjectStorageIntegrityError("Stored fact review outcome is invalid");
  }
  if (rawStatus === "extracted" || rawStatus === "needs_review") return rawStatus;
  throw new ObjectStorageIntegrityError("Stored fact review status is invalid");
}

function factReviewSummary(row: FactRow): DocumentFactsResponse["items"][number]["review"] {
  const decisionFields = [
    row.review_id,
    row.review_decided_at,
    row.review_decided_by_user_id,
    row.review_decided_by_display_name,
    row.review_observation_id,
    row.corrected_source_name,
    row.corrected_source_value,
    row.corrected_source_unit,
  ];
  if (row.decision_outcome === null) {
    if (decisionFields.some((value) => value !== null)) {
      throw new ObjectStorageIntegrityError("Stored fact review is invalid");
    }
    return null;
  }

  const outcome = factReviewOutcome(row.decision_outcome);
  const observationId = nullableBoundedString(
    row.review_observation_id,
    200,
    "fact review observation",
  );
  if (
    (outcome === "rejected" && observationId !== null) ||
    (outcome !== "rejected" && observationId === null)
  ) {
    throw new ObjectStorageIntegrityError("Stored fact review observation is invalid");
  }

  const correctionFields = [
    row.corrected_source_name,
    row.corrected_source_value,
    row.corrected_source_unit,
  ];
  const correction =
    outcome === "corrected"
      ? {
          sourceName: requiredBoundedString(
            row.corrected_source_name,
            200,
            "fact review correction source name",
          ),
          sourceValue: requiredBoundedString(
            row.corrected_source_value,
            100,
            "fact review correction source value",
          ),
          sourceUnit: requiredBoundedString(
            row.corrected_source_unit,
            100,
            "fact review correction source unit",
          ),
        }
      : (() => {
          if (correctionFields.some((value) => value !== null)) {
            throw new ObjectStorageIntegrityError("Stored fact review correction is invalid");
          }
          return null;
        })();

  return {
    id: requiredBoundedString(row.review_id, 200, "fact review id"),
    outcome,
    decidedAt: canonicalTimestamp(
      requiredBoundedString(row.review_decided_at, 100, "fact review time"),
    ),
    decidedBy: {
      id: requiredBoundedString(row.review_decided_by_user_id, 200, "fact review actor"),
      displayName: requiredBoundedString(
        row.review_decided_by_display_name,
        120,
        "fact review actor display name",
      ),
    },
    observationId,
    correction,
  };
}

function factResponse(
  run: { id: string; extractor_version: string },
  rows: readonly FactRow[],
): DocumentFactsResponse {
  return {
    schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
    extractionRunId: run.id,
    extractorVersion: run.extractor_version,
    items: rows.map((row) => ({
      id: row.id,
      factVersion: 1,
      canonicalDisplayName: nullableBoundedString(
        row.canonical_display_name,
        200,
        "fact canonical display name",
      ),
      factKey: requiredBoundedString(row.fact_key, 100, "fact key"),
      sourceName: requiredBoundedString(row.source_name, 200, "fact source name"),
      sourceValue: requiredBoundedString(row.source_value, 100, "fact source value"),
      sourceUnit: requiredBoundedString(row.source_unit, 100, "fact source unit"),
      proposedCanonicalCode: nullableBoundedString(
        row.proposed_canonical_code,
        100,
        "fact canonical code",
      ),
      proposedNormalizedValue: nullableBoundedString(
        row.proposed_normalized_value,
        100,
        "fact normalized value",
      ),
      proposedNormalizedUnit: nullableBoundedString(
        row.proposed_normalized_unit,
        100,
        "fact normalized unit",
      ),
      proposedSampledAt: nullableCanonicalTimestamp(row.proposed_sampled_at, "fact sampled time"),
      proposedResultedAt: nullableCanonicalTimestamp(row.proposed_resulted_at, "fact result time"),
      proposedSpecimenType: nullableBoundedString(row.proposed_specimen, 200, "fact specimen"),
      proposedLaboratory: nullableBoundedString(row.proposed_laboratory, 200, "fact laboratory"),
      referenceRange:
        row.proposed_reference_range === null ? null : referenceRange(row.proposed_reference_range),
      confidence: (() => {
        const confidence = Number(row.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
          throw new ObjectStorageIntegrityError("Stored fact confidence is invalid");
        }
        return confidence;
      })(),
      validationIssues: stringArray(row.validation_issues, "validation issues"),
      reviewStatus: derivedReviewStatus(row.review_status, row.decision_outcome),
      review: factReviewSummary(row),
      source: {
        documentVersionId: requiredBoundedString(
          row.document_version_id,
          200,
          "fact document version",
        ),
        pageNumber: (() => {
          const pageNumber = asCount(row.page_number, "page number");
          if (pageNumber < 1) {
            throw new ObjectStorageIntegrityError("Stored page number is invalid");
          }
          return pageNumber;
        })(),
        fragment: requiredBoundedString(row.source_fragment, 2_000, "fact source fragment"),
      },
    })),
  };
}

async function enrichStoredFactRow(client: DatabaseClient, row: FactRow): Promise<FactRow> {
  const mapped = await resolveAnalyteMapping(client, {
    sourceName: row.source_name,
    sourceUnit: row.source_unit,
    sourceValue: row.source_value,
    proposedLaboratory: row.proposed_laboratory,
    proposedNormalizedValue: row.proposed_normalized_value,
  });
  const canonicalCode = mapped?.canonicalCode ?? row.proposed_canonical_code;
  if (canonicalCode === null) return { ...row, canonical_display_name: null };
  const displayName =
    mapped?.displayName ??
    (
      await client.query<{ display_name: string }>(
        "SELECT display_name FROM analyte_catalog WHERE canonical_code = $1",
        [canonicalCode],
      )
    ).rows[0]?.display_name ??
    null;
  return {
    ...row,
    canonical_display_name: displayName,
    proposed_canonical_code: canonicalCode,
    proposed_normalized_value: mapped?.normalizedValue ?? row.proposed_normalized_value,
    proposed_normalized_unit: mapped?.normalizedUnit ?? row.proposed_normalized_unit,
  };
}

function nullableStoredText(value: unknown, maximum: number, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  }
  return value;
}

function requiredStoredText(value: unknown, maximum: number, label: string): string {
  const parsed = nullableStoredText(value, maximum, label);
  if (parsed === null) throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  return parsed;
}

function requiredCanonicalUuid(value: unknown, label: string): string {
  const parsed = requiredBoundedString(value, 200, label);
  if (!canonicalUuidPattern.test(parsed)) {
    throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  }
  return parsed;
}

function observationReferenceRange(
  row: ObservationHistoryRow,
): ObservationHistoryResponse["items"][number]["referenceRange"] {
  const sourceText = nullableStoredText(
    row.reference_source_text,
    1_000,
    "observation reference source text",
  );
  const sourceLow = nullableBoundedString(
    row.reference_source_low,
    100,
    "observation reference source low",
  );
  const sourceHigh = nullableBoundedString(
    row.reference_source_high,
    100,
    "observation reference source high",
  );
  const sourceUnit = nullableBoundedString(
    row.reference_source_unit,
    100,
    "observation reference source unit",
  );
  const laboratoryOutOfRange =
    row.reference_laboratory_out_of_range === null
      ? null
      : row.reference_laboratory_out_of_range === 0
        ? false
        : row.reference_laboratory_out_of_range === 1
          ? true
          : (() => {
              throw new ObjectStorageIntegrityError(
                "Stored observation reference laboratory flag is invalid",
              );
            })();
  const normalizedLow = nullableBoundedString(
    row.reference_normalized_low,
    100,
    "observation reference normalized low",
  );
  const normalizedHigh = nullableBoundedString(
    row.reference_normalized_high,
    100,
    "observation reference normalized high",
  );
  const normalizedUnit = nullableBoundedString(
    row.reference_normalized_unit,
    100,
    "observation reference normalized unit",
  );
  const conversionVersion = nullableBoundedString(
    row.reference_conversion_version,
    100,
    "observation reference conversion version",
  );
  const sourceValues = [sourceText, sourceLow, sourceHigh, sourceUnit, laboratoryOutOfRange];
  const normalizedValues = [normalizedLow, normalizedHigh, normalizedUnit, conversionVersion];
  if (sourceValues.every((value) => value === null)) {
    if (normalizedValues.some((value) => value !== null)) {
      throw new ObjectStorageIntegrityError("Stored observation reference range is invalid");
    }
    return null;
  }
  if (
    !(
      normalizedValues.every((value) => value === null) ||
      ((normalizedLow !== null || normalizedHigh !== null) &&
        normalizedUnit !== null &&
        conversionVersion !== null)
    )
  ) {
    throw new ObjectStorageIntegrityError("Stored observation reference normalization is invalid");
  }
  return {
    sourceText,
    sourceLow,
    sourceHigh,
    sourceUnit,
    laboratoryOutOfRange,
    normalizedLow,
    normalizedHigh,
    normalizedUnit,
    conversionVersion,
  };
}

function observationHistoryItem(
  row: ObservationHistoryRow,
  scope: { familyId: string; profileId: string },
): ObservationHistoryResponse["items"][number] {
  const canonicalCode = nullableBoundedString(
    row.canonical_code,
    100,
    "observation canonical code",
  );
  if (canonicalCode !== null && !canonicalCodePattern.test(canonicalCode)) {
    throw new ObjectStorageIntegrityError("Stored observation canonical code is invalid");
  }
  const normalizedValue = nullableBoundedString(
    row.normalized_value,
    100,
    "observation normalized value",
  );
  const normalizedUnit = nullableBoundedString(
    row.normalized_unit,
    100,
    "observation normalized unit",
  );
  const conversionVersion = nullableBoundedString(
    row.conversion_version,
    100,
    "observation conversion version",
  );
  const normalizedValues = [normalizedValue, normalizedUnit, conversionVersion];
  if (!(normalizedValues.every((value) => value === null) || normalizedValues.every(Boolean))) {
    throw new ObjectStorageIntegrityError("Stored observation normalization is invalid");
  }
  const sampledAt = nullableCanonicalTimestamp(row.sampled_at, "observation sampled time");
  const resultedAt = nullableCanonicalTimestamp(row.resulted_at, "observation result time");
  const uploadedAt = canonicalTimestamp(row.uploaded_at);
  const timelineAt = canonicalTimestamp(row.timeline_at);
  if (timelineAt !== (sampledAt ?? resultedAt ?? uploadedAt)) {
    throw new ObjectStorageIntegrityError("Stored observation timeline is invalid");
  }
  const pageNumber = asCount(row.page_number, "observation page number");
  if (pageNumber < 1)
    throw new ObjectStorageIntegrityError("Stored observation page number is invalid");
  const extractionConfidence = Number(row.extraction_confidence);
  if (
    !Number.isFinite(extractionConfidence) ||
    extractionConfidence < 0 ||
    extractionConfidence > 1
  ) {
    throw new ObjectStorageIntegrityError("Stored observation confidence is invalid");
  }
  const id = requiredCanonicalUuid(row.id, "observation id");
  const documentId = requiredCanonicalUuid(row.document_id, "observation document");
  const documentVersionId = requiredCanonicalUuid(
    row.document_version_id,
    "observation document version",
  );
  return {
    id,
    canonicalCode,
    source: {
      name: requiredBoundedString(row.source_name, 200, "observation source name"),
      value: requiredBoundedString(row.source_value, 100, "observation source value"),
      unit: requiredBoundedString(row.source_unit, 100, "observation source unit"),
    },
    normalized: {
      value: normalizedValue,
      unit: normalizedUnit,
      conversionVersion,
    },
    referenceRange: observationReferenceRange(row),
    dates: { sampledAt, resultedAt, uploadedAt },
    timelineAt,
    specimenType: nullableBoundedString(row.specimen_type, 200, "observation specimen"),
    laboratory: nullableBoundedString(row.laboratory, 200, "observation laboratory"),
    extractionConfidence,
    confirmed: {
      at: canonicalTimestamp(row.confirmed_at),
      by: {
        id: requiredCanonicalUuid(row.confirmed_by_user_id, "observation reviewer"),
        displayName: requiredBoundedString(
          row.confirmed_by_display_name,
          200,
          "observation reviewer name",
        ),
      },
    },
    sourceDocument: {
      id: documentId,
      versionId: documentVersionId,
      pageNumber,
      fragment: requiredStoredText(row.source_fragment, 4_000, "observation source fragment"),
      contentPath: `/v1/families/${scope.familyId}/profiles/${scope.profileId}/documents/${documentId}/content`,
    },
  };
}

const healthSummaryMissingData = new Set([
  "confirmed_observations",
  "sample_date",
  "result_date",
  "laboratory",
  "canonical_indicator",
] as const);
const healthSummaryRecommendationCodes = new Set([
  "prepare_source_for_clinician",
  "complete_pending_review",
] as const);

function healthSummaryStringArray<T extends string>(
  value: string,
  allowed: ReadonlySet<T>,
  label: string,
): readonly T[] {
  const parsed = parseStoredObject<unknown>(value, label);
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string" || !allowed.has(entry as T)) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new ObjectStorageIntegrityError(`Stored ${label} is invalid`);
  }
  return parsed as readonly T[];
}

function healthSummaryResponse(
  scope: { familyId: string; profileId: string },
  rows: readonly HealthSummaryRow[],
): HealthSummaryResponse {
  const first = rows[0];
  if (first === undefined) {
    return { contractVersion: HEALTH_SUMMARY_CONTRACT_VERSION, summary: null };
  }
  const summaryId = requiredCanonicalUuid(first.summary_id, "health summary");
  const version = asCount(first.version, "health summary version");
  if (version < 1)
    throw new ObjectStorageIntegrityError("Stored health summary version is invalid");
  const createdAt = canonicalTimestamp(first.created_at);
  const includedEvidenceCount = asCount(
    first.included_evidence_count,
    "health summary evidence count",
  );
  const totalConfirmedObservationCount = asCount(
    first.available_confirmed_observation_count,
    "health summary confirmed observation count",
  );
  if (
    includedEvidenceCount < 1 ||
    includedEvidenceCount > MAX_HEALTH_SUMMARY_EVIDENCE ||
    totalConfirmedObservationCount < includedEvidenceCount ||
    rows.length !== includedEvidenceCount
  ) {
    throw new ObjectStorageIntegrityError("Stored health summary evidence count is invalid");
  }
  const previous =
    first.previous_summary_id === null
      ? (() => {
          if (
            version !== 1 ||
            first.previous_version !== null ||
            first.previous_created_at !== null
          ) {
            throw new ObjectStorageIntegrityError("Stored initial health summary is invalid");
          }
          return null;
        })()
      : (() => {
          const previousVersion = asCount(first.previous_version ?? -1, "previous summary version");
          if (previousVersion !== version - 1 || first.previous_created_at === null) {
            throw new ObjectStorageIntegrityError("Stored previous health summary is invalid");
          }
          return {
            id: requiredCanonicalUuid(first.previous_summary_id, "previous health summary"),
            version: previousVersion,
            createdAt: canonicalTimestamp(first.previous_created_at),
          };
        })();
  const missingData = healthSummaryStringArray(
    first.missing_data,
    healthSummaryMissingData,
    "health summary missing data",
  );
  const recommendations = healthSummaryStringArray(
    first.recommendation_codes,
    healthSummaryRecommendationCodes,
    "health summary recommendation codes",
  ).map((code) => ({ code }));
  const evidence = rows.map((row, index) => {
    if (
      row.summary_id !== first.summary_id ||
      row.version !== first.version ||
      row.created_at !== first.created_at ||
      row.previous_summary_id !== first.previous_summary_id ||
      row.included_evidence_count !== first.included_evidence_count ||
      row.available_confirmed_observation_count !== first.available_confirmed_observation_count ||
      row.missing_data !== first.missing_data ||
      row.recommendation_codes !== first.recommendation_codes
    ) {
      throw new ObjectStorageIntegrityError("Stored health summary rows are inconsistent");
    }
    if (row.is_new_since_previous_summary !== 0 && row.is_new_since_previous_summary !== 1) {
      throw new ObjectStorageIntegrityError("Stored health summary evidence state is invalid");
    }
    if (asCount(row.position, "health summary evidence position") !== index + 1) {
      throw new ObjectStorageIntegrityError("Stored health summary evidence order is invalid");
    }
    return {
      isNewSincePreviousSummary: row.is_new_since_previous_summary === 1,
      observation: observationHistoryItem(row, scope),
    };
  });
  const syntheticEvidence = evidence.filter(
    ({ observation }) =>
      observation.canonicalCode !== null &&
      syntheticIndicatorCatalog.has(observation.canonicalCode),
  );
  const otherEvidence = evidence.filter(
    ({ observation }) =>
      observation.canonicalCode === null ||
      !syntheticIndicatorCatalog.has(observation.canonicalCode),
  );
  const groups: HealthSummary["groups"] = [
    ...(syntheticEvidence.length > 0
      ? [
          {
            id: "synthetic_laboratory" as const,
            label: "Подтверждённые синтетические показатели",
            evidence: syntheticEvidence,
          },
        ]
      : []),
    ...(otherEvidence.length > 0
      ? [
          {
            id: "other_confirmed_source" as const,
            label: "Другие подтверждённые источники",
            evidence: otherEvidence,
          },
        ]
      : []),
  ];
  const newEvidenceCount = evidence.filter(
    ({ isNewSincePreviousSummary }) => isNewSincePreviousSummary,
  ).length;
  return {
    contractVersion: HEALTH_SUMMARY_CONTRACT_VERSION,
    summary: {
      id: summaryId,
      version,
      createdAt,
      previous,
      evidenceScope: { includedCount: includedEvidenceCount, totalConfirmedObservationCount },
      groups,
      newEvidenceCount,
      carriedForwardEvidenceCount: evidence.length - newEvidenceCount,
      missingData,
      recommendations,
      redFlagStatus: "not_evaluated",
    },
  };
}

async function resetDeadLetterJob(
  client: DatabaseClient,
  scope: { familyId: string; documentVersionId: string; jobId: string },
  now: Date,
): Promise<void> {
  const timestamp = now.toISOString();
  const updated = await client.query(
    `UPDATE processing_jobs
        SET state = 'pending', current_stage = NULL, attempt_count = 0,
            lease_owner = NULL, lease_expires_at = NULL,
            last_error_code = NULL, last_error_message = NULL,
            available_at = $1, completed_at = NULL, updated_at = $1
      WHERE family_id = $2 AND document_version_id = $3 AND id = $4 AND state = 'dead_letter'`,
    [timestamp, scope.familyId, scope.documentVersionId, scope.jobId],
  );
  if (updated.rowCount !== 1) throw new ProcessingNotAvailableError();
  await appendProcessingEventInTransaction(client, {
    familyId: scope.familyId,
    documentVersionId: scope.documentVersionId,
    jobId: scope.jobId,
    code: "queued",
    attempt: 0,
    occurredAt: now,
  });
}

export function createDocumentService(
  database: Database,
  storage: ObjectStorage,
  options: DocumentServiceOptions,
): DocumentService {
  if (
    !Number.isSafeInteger(options.maxDocumentBytes) ||
    options.maxDocumentBytes < pngSignature.byteLength
  ) {
    throw new Error("maxDocumentBytes must fit a document signature");
  }

  async function createProfileArchive(
    actor: SessionActor,
    requestedScope: { familyId: string; profileId: string },
    correlationId: string,
    archiveOptions: ProfileArchiveOptions,
  ): Promise<EvidenceBundleContent> {
    const scope = canonicalProfileScope(requestedScope);
    return database.transaction(async (client) => {
      await requireProfileWriteAccess(client, actor, scope.familyId, scope.profileId);
      const profile = (
        await client.query<EvidenceBundleProfileRow>(
          `SELECT id, family_id, display_name, kind, created_at
             FROM patient_profiles
            WHERE family_id = $1 AND id = $2 AND archived_at IS NULL`,
          [scope.familyId, scope.profileId],
        )
      ).rows[0];
      if (profile === undefined) throw new ResourceNotFoundError();
      const documentRows = await client.query<EvidenceBundleDocumentRow>(
        `SELECT d.id,
                d.family_id,
                d.patient_profile_id,
                d.status,
                d.original_filename,
                d.uploaded_at,
                duplicate.id AS duplicate_of_document_id,
                duplicate.patient_profile_id AS duplicate_profile_id,
                COALESCE(blob_type.content_type, b.content_type) AS content_type,
                b.byte_size,
                b.sha256,
                b.storage_key,
                v.id AS document_version_id
           FROM documents d
           JOIN document_versions v
             ON v.family_id = d.family_id AND v.document_id = d.id AND v.version_number = 1
           JOIN document_blobs b ON b.family_id = v.family_id AND b.id = v.blob_id
           LEFT JOIN document_blob_content_types blob_type
             ON blob_type.family_id = b.family_id AND blob_type.blob_id = b.id
           LEFT JOIN documents duplicate
             ON duplicate.family_id = d.family_id AND duplicate.id = d.duplicate_of_document_id
            AND duplicate.deleted_at IS NULL
          WHERE d.family_id = $1 AND d.patient_profile_id = $2 AND d.deleted_at IS NULL
          ORDER BY d.uploaded_at DESC, d.id DESC
          LIMIT $3`,
        [scope.familyId, scope.profileId, archiveOptions.maximumDocuments + 1],
      );
      if (
        archiveOptions.failWhenOverLimit &&
        documentRows.rows.length > archiveOptions.maximumDocuments
      ) {
        throw new DomainConflictError();
      }
      const selectedDocumentRows = archiveOptions.failWhenOverLimit
        ? documentRows.rows
        : documentRows.rows.slice(0, archiveOptions.maximumDocuments);
      const documents = selectedDocumentRows.map(evidenceBundleDocument);
      const documentByVersion = new Map(
        documents.map((document) => [document.versionId, document]),
      );
      const selectedVersionIds = documents.map((document) => document.versionId);
      const observations: SyntheticEvidenceBundleManifest["observations"][number][] = [];
      if (selectedVersionIds.length > 0) {
        const placeholders = selectedVersionIds.map((_, index) => `$${index + 3}`).join(", ");
        const observationRows = await client.query<ObservationHistoryRow>(
          `SELECT o.id, o.canonical_code, o.source_name, o.source_value, o.source_unit,
                  o.normalized_value, o.normalized_unit, o.conversion_version,
                  o.sampled_at, o.resulted_at, o.uploaded_at, o.specimen_type, o.laboratory,
                  o.source_fragment, o.extraction_confidence, o.confirmed_at,
                  o.confirmed_by_user_id, reviewer.display_name AS confirmed_by_display_name,
                  o.document_id, o.document_version_id, page.page_number,
                  COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) AS timeline_at,
                  reference_range.source_text AS reference_source_text,
                  reference_range.source_low AS reference_source_low,
                  reference_range.source_high AS reference_source_high,
                  reference_range.source_unit AS reference_source_unit,
                  reference_range.laboratory_out_of_range AS reference_laboratory_out_of_range,
                  reference_range.normalized_low AS reference_normalized_low,
                  reference_range.normalized_high AS reference_normalized_high,
                  reference_range.normalized_unit AS reference_normalized_unit,
                  reference_range.conversion_version AS reference_conversion_version
             FROM observations o
             JOIN document_pages page
               ON page.family_id = o.family_id
              AND page.id = o.document_page_id
              AND page.document_version_id = o.document_version_id
             JOIN documents source_document
               ON source_document.family_id = o.family_id
              AND source_document.id = o.document_id
              AND source_document.deleted_at IS NULL
             JOIN users reviewer ON reviewer.id = o.confirmed_by_user_id
             LEFT JOIN observation_reference_ranges reference_range
               ON reference_range.family_id = o.family_id
              AND reference_range.observation_id = o.id
            WHERE o.family_id = $1
              AND o.patient_profile_id = $2
              AND o.status = 'confirmed'
              AND o.document_version_id IN (${placeholders})
            ORDER BY COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) ASC, o.id ASC`,
          [scope.familyId, scope.profileId, ...selectedVersionIds],
        );
        for (const row of observationRows.rows) {
          const item = observationHistoryItem(row, scope);
          const document = documentByVersion.get(item.sourceDocument.versionId);
          if (document === undefined) {
            throw new ObjectStorageIntegrityError("Export observation source is inconsistent");
          }
          const { contentPath: _contentPath, ...sourceDocument } = item.sourceDocument;
          observations.push({
            ...item,
            sourceDocument: { ...sourceDocument, archivePath: document.archivePath },
          });
        }
      }
      const manifest = {
        contractVersion: archiveOptions.contractVersion,
        exportedAt: new Date().toISOString(),
        profile: evidenceBundleProfile(profile),
        documents,
        observations,
      } as SyntheticEvidenceBundleManifest | SyntheticProfileExportManifest;
      const sources = await Promise.all(
        selectedDocumentRows.map(async (row, index) => {
          const document = documents[index];
          if (document === undefined)
            throw new ObjectStorageIntegrityError("Export document missing");
          const expected = {
            contentType: row.content_type,
            byteSize: byteSize(row.byte_size),
            sha256: canonicalChecksum(row.sha256, "export checksum"),
          };
          const stored = await storage.get(createObjectStorageKey(row.storage_key), expected);
          if (!metadataMatches(stored.metadata, expected)) {
            throw new ObjectStorageIntegrityError("Export storage metadata is inconsistent");
          }
          const chunks: Buffer[] = [];
          for await (const chunk of stored.body) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return { path: document.archivePath, bytes: Buffer.concat(chunks) };
        }),
      );
      const archive = createSyntheticEvidenceBundle({ manifest, sources });
      await audit(client, {
        familyId: scope.familyId,
        actorUserId: actor.userId,
        action: archiveOptions.action,
        resourceType: "PatientProfile",
        resourceId: scope.profileId,
        correlationId,
        createdAt: new Date(),
        contractVersion: archiveOptions.contractVersion,
      });
      return { body: Readable.from([archive]), byteSize: archive.length };
    });
  }

  return {
    async requireProfileWriteAccess(actor, requestedScope) {
      const scope = canonicalProfileScope(requestedScope);
      await requireProfileWriteAccess(database, actor, scope.familyId, scope.profileId);
    },

    async stageDocument(input) {
      const contentType = documentContentType(input.contentType);
      if (contentType === null) {
        input.body.resume();
        throw new UnsupportedDocumentTypeError();
      }
      try {
        const metadata = await storage.putStaging({
          key: stagingObjectKey(),
          body: Readable.from(verifiedDocumentBytes(input.body, contentType)),
          contentType,
          maxBytes: options.maxDocumentBytes,
        });
        return { metadata, originalFilename: safeFilename(input.filename, contentType) };
      } catch (error) {
        if (error instanceof ObjectStorageSizeLimitError) throw new UploadTooLargeError();
        throw error;
      }
    },

    async discardStaged(staged) {
      await storage.deleteStaging(staged.metadata.key);
    },

    async acceptUpload(actor, requestedScope, staged, idempotencyKey, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const keyHash = sha256(idempotencyKey);
      try {
        return await database
          .transaction(async (client) => {
            await requireProfileWriteAccess(client, actor, scope.familyId, scope.profileId);

            const replay = await client.query<UploadRequestRow>(
              `SELECT document_id,
                    patient_profile_id,
                    request_byte_size,
                    COALESCE(rt.content_type, request_content_type) AS request_content_type,
                    request_sha256
             FROM document_upload_requests
             LEFT JOIN document_upload_request_content_types rt
               ON rt.family_id = document_upload_requests.family_id
              AND rt.upload_request_id = document_upload_requests.id
             WHERE document_upload_requests.family_id = $1
               AND document_upload_requests.actor_user_id = $2
               AND document_upload_requests.idempotency_key_hash = $3`,
              [scope.familyId, actor.userId, keyHash],
            );
            const reuseReplay =
              replay.rows[0] === undefined
                ? await client.query<UploadRequestRow>(
                    `SELECT document_id, patient_profile_id, request_byte_size,
                            request_content_type, request_sha256
                       FROM document_upload_reuse_requests
                      WHERE family_id = $1
                        AND actor_user_id = $2
                        AND idempotency_key_hash = $3`,
                    [scope.familyId, actor.userId, keyHash],
                  )
                : null;
            const previous = replay.rows[0] ?? reuseReplay?.rows[0];
            if (previous !== undefined) {
              if (
                previous.patient_profile_id !== scope.profileId ||
                previous.request_sha256 !== staged.metadata.sha256 ||
                previous.request_content_type !== staged.metadata.contentType ||
                byteSize(previous.request_byte_size) !== staged.metadata.byteSize
              ) {
                throw new IdempotencyConflictError();
              }
              const replayed = await documentRow(
                client,
                actor,
                {
                  ...scope,
                  documentId: previous.document_id,
                },
                "write",
              );
              await audit(client, {
                familyId: scope.familyId,
                actorUserId: actor.userId,
                action: "document.upload.replayed",
                resourceId: replayed.id,
                correlationId,
                createdAt: new Date(),
              });
              return { row: replayed, disposition: "already_exists" as const };
            }

            const existingBlobs = await client.query<BlobRow>(
              `SELECT b.id, b.storage_key, COALESCE(bt.content_type, b.content_type) AS content_type,
                      b.byte_size, b.sha256
                 FROM document_blobs b
                 LEFT JOIN document_blob_content_types bt
                   ON bt.family_id = b.family_id
                  AND bt.blob_id = b.id
             WHERE b.family_id = $1 AND b.sha256 = $2`,
              [scope.familyId, staged.metadata.sha256],
            );
            let blob = existingBlobs.rows[0];
            if (blob === undefined) {
              const finalKey = finalObjectKey(scope.familyId, staged.metadata.sha256);
              const finalized = await storage.finalize(staged.metadata.key, finalKey);
              if (!metadataMatches(finalized.metadata, staged.metadata)) {
                throw new ObjectStorageIntegrityError(
                  "Final object metadata does not match the staged upload",
                );
              }
              blob = {
                id: randomUUID(),
                storage_key: finalKey,
                content_type: staged.metadata.contentType as SyntheticDocumentContentType,
                byte_size: staged.metadata.byteSize,
                sha256: staged.metadata.sha256,
              };
              await client.query(
                `INSERT INTO document_blobs
                 (id, family_id, storage_contract_version, storage_key, content_type,
                  byte_size, sha256)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  blob.id,
                  scope.familyId,
                  OBJECT_STORAGE_CONTRACT_VERSION,
                  blob.storage_key,
                  "application/pdf",
                  staged.metadata.byteSize,
                  blob.sha256,
                ],
              );
              if (blob.content_type !== "application/pdf") {
                await client.query(
                  `INSERT INTO document_blob_content_types
                     (blob_id, family_id, content_type, created_at)
                   VALUES ($1, $2, $3, $4)`,
                  [blob.id, scope.familyId, blob.content_type, new Date()],
                );
              }
            } else {
              const metadata = await storage.stat(createObjectStorageKey(blob.storage_key));
              if (
                byteSize(blob.byte_size) !== staged.metadata.byteSize ||
                metadata === null ||
                !metadataMatches(metadata, staged.metadata)
              ) {
                throw new ObjectStorageIntegrityError(
                  "Persisted blob metadata does not match immutable storage",
                );
              }
            }

            const existingLogical = (
              await client.query<{ id: string }>(
                `SELECT document.id
                   FROM document_versions version
                   JOIN documents document
                     ON document.family_id = version.family_id
                    AND document.id = version.document_id
                  WHERE version.family_id = $1
                    AND version.blob_id = $2
                    AND version.version_number = 1
                    AND document.patient_profile_id = $3
                    AND document.deleted_at IS NULL
                  ORDER BY document.uploaded_at, document.id
                  LIMIT 1`,
                [scope.familyId, blob.id, scope.profileId],
              )
            ).rows[0];
            if (existingLogical !== undefined) {
              const now = new Date();
              await client.query(
                `INSERT INTO document_upload_reuse_requests
                   (id, family_id, actor_user_id, patient_profile_id, idempotency_key_hash,
                    request_sha256, request_content_type, request_byte_size, document_id, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                  randomUUID(),
                  scope.familyId,
                  actor.userId,
                  scope.profileId,
                  keyHash,
                  staged.metadata.sha256,
                  staged.metadata.contentType,
                  staged.metadata.byteSize,
                  existingLogical.id,
                  now,
                ],
              );
              const existing = await documentRow(
                client,
                actor,
                { ...scope, documentId: existingLogical.id },
                "write",
              );
              await audit(client, {
                familyId: scope.familyId,
                actorUserId: actor.userId,
                action: "document.upload.deduplicated",
                resourceId: existing.id,
                correlationId,
                createdAt: now,
              });
              return { row: existing, disposition: "already_exists" as const };
            }

            const duplicate = await client.query<{
              id: string;
              patient_profile_id: string;
            }>(
              `SELECT d.id, d.patient_profile_id
             FROM document_versions v
             JOIN documents d
               ON d.family_id = v.family_id
              AND d.id = v.document_id
             WHERE v.family_id = $1 AND v.blob_id = $2 AND d.deleted_at IS NULL
             ORDER BY d.uploaded_at, d.id
             LIMIT 1`,
              [scope.familyId, blob.id],
            );
            const duplicateRow = duplicate.rows[0];
            const now = new Date();
            const uploadedAt = now.toISOString();
            const documentId = randomUUID();
            await client.query(
              `INSERT INTO documents
               (id, family_id, patient_profile_id, status, original_filename,
                uploaded_by_user_id, uploaded_at, duplicate_of_document_id)
             VALUES ($1, $2, $3, 'uploaded', $4, $5, $6, $7)`,
              [
                documentId,
                scope.familyId,
                scope.profileId,
                staged.originalFilename,
                actor.userId,
                uploadedAt,
                duplicateRow?.id ?? null,
              ],
            );
            const documentVersionId = randomUUID();
            await client.query(
              `INSERT INTO document_versions
               (id, family_id, document_id, blob_id, version_number, created_at)
             VALUES ($1, $2, $3, $4, 1, $5)`,
              [documentVersionId, scope.familyId, documentId, blob.id, uploadedAt],
            );
            await enqueueDocumentExtractionInTransaction(client, {
              familyId: scope.familyId,
              documentVersionId,
              now,
            });
            await client.query(
              `INSERT INTO document_upload_requests
               (id, family_id, actor_user_id, patient_profile_id, idempotency_key_hash,
                request_sha256, request_content_type, request_byte_size, document_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                randomUUID(),
                scope.familyId,
                actor.userId,
                scope.profileId,
                keyHash,
                staged.metadata.sha256,
                "application/pdf",
                staged.metadata.byteSize,
                documentId,
                uploadedAt,
              ],
            );
            if (staged.metadata.contentType !== "application/pdf") {
              const uploadRequest = await client.query<{ id: string }>(
                `SELECT id
                   FROM document_upload_requests
                  WHERE family_id = $1
                    AND actor_user_id = $2
                    AND idempotency_key_hash = $3`,
                [scope.familyId, actor.userId, keyHash],
              );
              const uploadRequestId = uploadRequest.rows[0]?.id;
              if (uploadRequestId === undefined) throw new ObjectStorageIntegrityError();
              await client.query(
                `INSERT INTO document_upload_request_content_types
                   (upload_request_id, family_id, content_type, created_at)
                 VALUES ($1, $2, $3, $4)`,
                [uploadRequestId, scope.familyId, staged.metadata.contentType, uploadedAt],
              );
            }
            await audit(client, {
              familyId: scope.familyId,
              actorUserId: actor.userId,
              action: "document.upload.received",
              resourceId: documentId,
              correlationId,
              createdAt: now,
            });
            return {
              row: {
                id: documentId,
                family_id: scope.familyId,
                patient_profile_id: scope.profileId,
                status: "uploaded",
                original_filename: staged.originalFilename,
                uploaded_at: uploadedAt,
                duplicate_of_document_id: duplicateRow?.id ?? null,
                duplicate_profile_id: duplicateRow?.patient_profile_id ?? null,
                content_type: blob.content_type,
                byte_size: blob.byte_size,
                sha256: blob.sha256,
                storage_key: blob.storage_key,
                document_version_id: documentVersionId,
              } satisfies DocumentRow,
              disposition: "created" as const,
            };
          })
          .then(({ row, disposition }) => ({
            disposition,
            document: summary(row, { state: "queued", updatedAt: row.uploaded_at }),
          }));
      } finally {
        await storage.deleteStaging(staged.metadata.key).catch(() => undefined);
      }
    },

    async getDocument(actor, requestedScope, correlationId) {
      const scope = canonicalDocumentScope(requestedScope);
      return database.transaction(async (client) => {
        const row = await documentRow(client, actor, scope);
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.metadata.opened",
          resourceId: scope.documentId,
          correlationId,
          createdAt: new Date(),
        });
        const intelligence = await intelligenceDetailForDocument(client, row);
        return {
          ...summary(row, await processingForDocument(client, row), intelligence),
          intelligence,
        };
      });
    },

    async searchDocuments(actor, requestedScope, requestedQuery, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const query = documentSearchQuery(requestedQuery.q);
      const limit = documentSearchLimit(requestedQuery.limit);
      return database.transaction(async (client) => {
        await requireProfileReadAccess(client, actor, scope.familyId, scope.profileId);
        const matching = await client.query<{ id: string }>(
          `SELECT document.id
             FROM documents document
             JOIN document_versions version
               ON version.family_id = document.family_id
              AND version.document_id = document.id
              AND version.version_number = 1
             JOIN document_intelligence_results intelligence
               ON intelligence.id = (
                 SELECT latest.id
                   FROM document_intelligence_results latest
                  WHERE latest.family_id = version.family_id
                    AND latest.document_version_id = version.id
                  ORDER BY latest.created_at DESC, latest.id DESC
                  LIMIT 1
               )
            WHERE document.family_id = $1
              AND document.patient_profile_id = $2
              AND document.deleted_at IS NULL
              AND instr(intelligence.search_text, $3) > 0
            ORDER BY COALESCE(intelligence.document_date, document.uploaded_at) DESC,
                     document.uploaded_at DESC, document.id DESC
            LIMIT $4`,
          [scope.familyId, scope.profileId, query, limit],
        );
        const documents: DocumentSummary[] = [];
        for (const match of matching.rows) {
          const row = await documentRow(client, actor, { ...scope, documentId: match.id });
          documents.push(
            summary(
              row,
              await processingForDocument(client, row),
              await intelligenceSummaryForDocument(client, row),
            ),
          );
        }
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "profile.documents.searched",
          resourceType: "PatientProfile",
          resourceId: scope.profileId,
          correlationId,
          createdAt: new Date(),
          contractVersion: DOCUMENT_SEARCH_CONTRACT_VERSION,
        });
        return { contractVersion: DOCUMENT_SEARCH_CONTRACT_VERSION, documents };
      });
    },

    async deleteDocument(actor, requestedScope, idempotencyKey, correlationId) {
      const scope = canonicalDocumentScope(requestedScope);
      const keyHash = sha256(idempotencyKey);
      return database.transaction(async (client) => {
        await requireProfileWriteAccess(client, actor, scope.familyId, scope.profileId);
        const replay = (
          await client.query<DeleteRequestRow>(
            `SELECT document_id, patient_profile_id, deleted_at
               FROM document_delete_requests
              WHERE family_id = $1 AND actor_user_id = $2 AND idempotency_key_hash = $3`,
            [scope.familyId, actor.userId, keyHash],
          )
        ).rows[0];
        if (replay !== undefined) {
          if (
            replay.patient_profile_id !== scope.profileId ||
            replay.document_id !== scope.documentId
          ) {
            throw new IdempotencyConflictError();
          }
          await audit(client, {
            familyId: scope.familyId,
            actorUserId: actor.userId,
            action: "document.delete.replayed",
            resourceId: scope.documentId,
            correlationId,
            createdAt: new Date(),
            contractVersion: DOCUMENT_LIFECYCLE_CONTRACT_VERSION,
          });
          return {
            response: {
              contractVersion: DOCUMENT_LIFECYCLE_CONTRACT_VERSION,
              documentId: scope.documentId,
              deletedAt: canonicalTimestamp(replay.deleted_at),
            },
            replayed: true,
          };
        }

        await documentRow(client, actor, scope, "write");
        const now = new Date();
        const deletedAt = now.toISOString();
        const deleted = await client.query(
          `UPDATE documents
              SET deleted_at = $1, deleted_by_user_id = $2
            WHERE family_id = $3
              AND patient_profile_id = $4
              AND id = $5
              AND deleted_at IS NULL`,
          [deletedAt, actor.userId, scope.familyId, scope.profileId, scope.documentId],
        );
        if (deleted.rowCount !== 1) throw new ResourceNotFoundError();
        await client.query(
          `INSERT INTO document_delete_requests
             (id, family_id, actor_user_id, patient_profile_id, document_id,
              idempotency_key_hash, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            scope.familyId,
            actor.userId,
            scope.profileId,
            scope.documentId,
            keyHash,
            deletedAt,
          ],
        );
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.deleted",
          resourceId: scope.documentId,
          correlationId,
          createdAt: now,
          contractVersion: DOCUMENT_LIFECYCLE_CONTRACT_VERSION,
        });
        return {
          response: {
            contractVersion: DOCUMENT_LIFECYCLE_CONTRACT_VERSION,
            documentId: scope.documentId,
            deletedAt,
          },
          replayed: false,
        };
      });
    },

    async getProcessing(actor, requestedScope, correlationId) {
      const scope = canonicalDocumentScope(requestedScope);
      return database.transaction(async (client) => {
        const row = await documentRow(client, actor, scope);
        const processing = await processingForDocument(client, row);
        const activity = await processingActivityForDocument(client, row);
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.processing.opened",
          resourceId: scope.documentId,
          correlationId,
          createdAt: new Date(),
        });
        return {
          contractVersion: DOCUMENT_CONTRACT_VERSION,
          documentId: row.id,
          processing,
          activity,
        };
      });
    },

    async getFacts(actor, requestedScope, correlationId) {
      const scope = canonicalDocumentScope(requestedScope);
      return database.transaction(async (client) => {
        const row = await documentRow(client, actor, scope);
        const run = (
          await client.query<ExtractionRunForFactsRow>(
            `SELECT id, extractor_version, status
               FROM extraction_runs
              WHERE family_id = $1 AND document_version_id = $2
                AND status IN ('awaiting_review', 'completed')
              ORDER BY created_at DESC, id DESC
              LIMIT 1`,
            [scope.familyId, row.document_version_id],
          )
        ).rows[0];
        if (run === undefined) throw new ResourceNotFoundError();
        const facts = await client.query<FactRow>(
          `SELECT f.id, f.document_version_id, p.page_number, f.fact_key,
                  f.source_fragment, f.source_name, f.source_value, f.source_unit,
                  f.proposed_canonical_code, f.proposed_normalized_value,
                  f.proposed_normalized_unit, f.proposed_reference_range,
                  f.proposed_specimen, f.proposed_sampled_at, f.proposed_resulted_at,
                  f.proposed_laboratory, f.confidence, f.validation_issues, f.review_status,
                  d.id AS review_id, d.outcome AS decision_outcome,
                  d.decided_at AS review_decided_at,
                  d.decided_by_user_id AS review_decided_by_user_id,
                  reviewer.display_name AS review_decided_by_display_name,
                  d.observation_id AS review_observation_id,
                  d.corrected_source_name, d.corrected_source_value,
                  d.corrected_source_unit, NULL AS canonical_display_name
             FROM extracted_facts f
             JOIN document_pages p
               ON p.family_id = f.family_id AND p.id = f.document_page_id
             LEFT JOIN review_decisions d
               ON d.family_id = f.family_id AND d.extracted_fact_id = f.id
             LEFT JOIN users reviewer
               ON reviewer.id = d.decided_by_user_id
            WHERE f.family_id = $1 AND f.extraction_run_id = $2
            ORDER BY p.page_number, f.fact_key`,
          [scope.familyId, run.id],
        );
        const response = factResponse(
          run,
          await Promise.all(facts.rows.map((fact) => enrichStoredFactRow(client, fact))),
        );
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.facts.opened",
          resourceId: scope.documentId,
          correlationId,
          createdAt: new Date(),
        });
        return response;
      });
    },

    async getObservationHistory(actor, requestedScope, requestedQuery, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const canonicalCode = historyCanonicalCode(requestedQuery.canonicalCode);
      const limit = observationHistoryLimit(requestedQuery.limit);
      return database.transaction(async (client) => {
        await requireProfileReadAccess(client, actor, scope.familyId, scope.profileId);
        const cursor = decodeObservationHistoryCursor(requestedQuery.cursor, canonicalCode);
        const observations = await client.query<ObservationHistoryRow>(
          `SELECT o.id, o.canonical_code, o.source_name, o.source_value, o.source_unit,
                  o.normalized_value, o.normalized_unit, o.conversion_version,
                  o.sampled_at, o.resulted_at, o.uploaded_at, o.specimen_type, o.laboratory,
                  o.source_fragment, o.extraction_confidence, o.confirmed_at,
                  o.confirmed_by_user_id, reviewer.display_name AS confirmed_by_display_name,
                  o.document_id, o.document_version_id, page.page_number,
                  COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) AS timeline_at,
                  reference_range.source_text AS reference_source_text,
                  reference_range.source_low AS reference_source_low,
                  reference_range.source_high AS reference_source_high,
                  reference_range.source_unit AS reference_source_unit,
                  reference_range.laboratory_out_of_range AS reference_laboratory_out_of_range,
                  reference_range.normalized_low AS reference_normalized_low,
                  reference_range.normalized_high AS reference_normalized_high,
                  reference_range.normalized_unit AS reference_normalized_unit,
                  reference_range.conversion_version AS reference_conversion_version
             FROM observations o
             JOIN document_pages page
               ON page.family_id = o.family_id
              AND page.id = o.document_page_id
              AND page.document_version_id = o.document_version_id
             JOIN users reviewer ON reviewer.id = o.confirmed_by_user_id
             LEFT JOIN observation_reference_ranges reference_range
               ON reference_range.family_id = o.family_id
              AND reference_range.observation_id = o.id
            WHERE o.family_id = $1
              AND o.patient_profile_id = $2
              AND o.status = 'confirmed'
              AND ($3 IS NULL OR o.canonical_code = $3)
              AND (
                $4 IS NULL
                OR COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) < $4
                OR (
                  COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) = $4
                  AND o.id < $5
                )
              )
            ORDER BY COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) DESC, o.id DESC
            LIMIT $6`,
          [
            scope.familyId,
            scope.profileId,
            canonicalCode,
            cursor?.timelineAt ?? null,
            cursor?.id ?? null,
            limit + 1,
          ],
        );
        const pageRows = observations.rows.slice(0, limit);
        const items = pageRows.map((row) => observationHistoryItem(row, scope));
        const lastItem = items.at(-1);
        const nextCursor =
          observations.rows.length > limit && lastItem !== undefined
            ? encodeObservationHistoryCursor({
                canonicalCode,
                id: lastItem.id,
                timelineAt: lastItem.timelineAt,
              })
            : null;
        const response: ObservationHistoryResponse = {
          contractVersion: OBSERVATION_HISTORY_CONTRACT_VERSION,
          items,
          nextCursor,
        };
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "observation.history.opened",
          resourceType: "PatientProfile",
          resourceId: scope.profileId,
          correlationId,
          createdAt: new Date(),
          contractVersion: OBSERVATION_HISTORY_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async getProfileOverview(actor, requestedScope, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      return database.transaction(async (client) => {
        await requireProfileReadAccess(client, actor, scope.familyId, scope.profileId);

        const profile = (
          await client.query<ProfileOverviewProfileRow>(
            `SELECT p.id,
                    p.family_id,
                    p.display_name,
                    p.kind,
                    p.created_at,
                    CASE
                      WHEN m.role = 'owner' THEN 'owner'
                      WHEN m.role = 'adult_member' AND p.linked_user_id = m.user_id THEN 'self'
                      ELSE 'granted_read'
                    END AS access
               FROM patient_profiles p
               JOIN family_memberships m
                 ON m.family_id = p.family_id
                AND m.user_id = $3
                AND m.status = 'active'
              WHERE p.family_id = $1
                AND p.id = $2
                AND p.archived_at IS NULL
                AND (
                  m.role = 'owner'
                  OR (m.role = 'adult_member' AND p.linked_user_id = m.user_id)
                  OR (
                    m.role IN ('adult_member', 'caregiver')
                    AND EXISTS (
                      SELECT 1
                        FROM profile_consent_grants g
                       WHERE g.family_id = p.family_id
                         AND g.patient_profile_id = p.id
                         AND g.grantee_user_id = m.user_id
                         AND g.capability = 'profile.read'
                         AND g.revoked_at IS NULL
                    )
                  )
                )`,
            [scope.familyId, scope.profileId, actor.userId],
          )
        ).rows[0];
        if (profile === undefined) throw new ResourceNotFoundError();

        const recentDocuments = await client.query<ProfileOverviewDocumentRow>(
          `SELECT d.id,
                  d.family_id,
                  d.patient_profile_id,
                  d.status,
                  d.original_filename,
                  d.uploaded_at,
                  duplicate.id AS duplicate_of_document_id,
                  duplicate.patient_profile_id AS duplicate_profile_id,
                  COALESCE(blob_type.content_type, b.content_type) AS content_type,
                  b.byte_size,
                  b.sha256,
                  b.storage_key,
                  v.id AS document_version_id,
                  j.id AS job_id,
                  j.state AS job_state,
                  j.current_stage AS job_current_stage,
                  j.last_error_code AS job_last_error_code,
                  j.updated_at AS job_updated_at,
                  r.id AS extraction_run_id,
                  r.status AS extraction_status,
                  intelligence.provider AS intelligence_provider,
                  intelligence.model_id AS intelligence_model_id,
                  intelligence.runtime_version AS intelligence_runtime_version,
                  intelligence.schema_version AS intelligence_schema_version,
                  intelligence.category AS intelligence_category,
                  intelligence.title AS intelligence_title,
                  intelligence.short_summary AS intelligence_short_summary,
                  intelligence.document_date AS intelligence_document_date,
                  intelligence.confidence AS intelligence_confidence,
                  COUNT(f.id) AS fact_count,
                  COALESCE(SUM(CASE WHEN d_review.id IS NULL AND f.id IS NOT NULL THEN 1 ELSE 0 END), 0)
                    AS pending_fact_count,
                  COALESCE(SUM(CASE
                    WHEN d_review.id IS NULL AND f.review_status = 'needs_review' THEN 1
                    ELSE 0
                  END), 0) AS needs_attention_fact_count
             FROM documents d
             JOIN document_versions v
               ON v.family_id = d.family_id AND v.document_id = d.id AND v.version_number = 1
             JOIN document_blobs b
               ON b.family_id = v.family_id AND b.id = v.blob_id
             LEFT JOIN document_blob_content_types blob_type
               ON blob_type.family_id = b.family_id AND blob_type.blob_id = b.id
             LEFT JOIN documents duplicate
               ON duplicate.family_id = d.family_id AND duplicate.id = d.duplicate_of_document_id
              AND duplicate.deleted_at IS NULL
             LEFT JOIN processing_jobs j
               ON j.id = (
                 SELECT latest_job.id
                   FROM processing_jobs latest_job
                  WHERE latest_job.family_id = d.family_id
                    AND latest_job.document_version_id = v.id
                    AND latest_job.kind = 'document_extraction'
                  ORDER BY latest_job.created_at DESC, latest_job.id DESC
                  LIMIT 1
               )
             LEFT JOIN extraction_runs r
               ON r.id = (
                 SELECT latest_run.id
                   FROM extraction_runs latest_run
                  WHERE latest_run.family_id = d.family_id
                    AND latest_run.document_version_id = v.id
                  ORDER BY latest_run.created_at DESC, latest_run.id DESC
                  LIMIT 1
               )
             LEFT JOIN document_intelligence_results intelligence
               ON intelligence.id = (
                 SELECT latest_intelligence.id
                   FROM document_intelligence_results latest_intelligence
                  WHERE latest_intelligence.family_id = d.family_id
                    AND latest_intelligence.document_version_id = v.id
                  ORDER BY latest_intelligence.created_at DESC, latest_intelligence.id DESC
                  LIMIT 1
               )
             LEFT JOIN extracted_facts f
               ON f.family_id = r.family_id AND f.extraction_run_id = r.id
             LEFT JOIN review_decisions d_review
               ON d_review.family_id = f.family_id AND d_review.extracted_fact_id = f.id
            WHERE d.family_id = $1 AND d.patient_profile_id = $2 AND d.deleted_at IS NULL
            GROUP BY d.id, d.family_id, d.patient_profile_id, d.status, d.original_filename,
                     d.uploaded_at, duplicate.id, duplicate.patient_profile_id,
                     blob_type.content_type, b.content_type, b.byte_size, b.sha256, b.storage_key,
                     v.id, j.id, j.state, j.current_stage, j.last_error_code, j.updated_at,
                     r.id, r.status, intelligence.provider, intelligence.model_id,
                     intelligence.runtime_version, intelligence.schema_version,
                     intelligence.category, intelligence.title, intelligence.short_summary,
                     intelligence.document_date, intelligence.confidence
            ORDER BY d.uploaded_at DESC, d.id DESC
            LIMIT 50`,
          [scope.familyId, scope.profileId],
        );

        const reviewQueue = (
          await client.query<ProfileOverviewQueueRow>(
            `SELECT COUNT(DISTINCT d.id) AS document_count,
                    COALESCE(SUM(CASE WHEN d_review.id IS NULL AND f.id IS NOT NULL THEN 1 ELSE 0 END), 0)
                      AS pending_fact_count,
                    COALESCE(SUM(CASE
                      WHEN d_review.id IS NULL AND f.review_status = 'needs_review' THEN 1
                      ELSE 0
                    END), 0) AS needs_attention_fact_count
               FROM documents d
               JOIN document_versions v
                 ON v.family_id = d.family_id AND v.document_id = d.id AND v.version_number = 1
               JOIN extraction_runs r
                 ON r.id = (
                   SELECT latest_run.id
                     FROM extraction_runs latest_run
                    WHERE latest_run.family_id = v.family_id
                      AND latest_run.document_version_id = v.id
                    ORDER BY latest_run.created_at DESC, latest_run.id DESC
                    LIMIT 1
                 )
                AND r.status = 'awaiting_review'
               LEFT JOIN extracted_facts f
                 ON f.family_id = r.family_id AND f.extraction_run_id = r.id
               LEFT JOIN review_decisions d_review
                 ON d_review.family_id = f.family_id AND d_review.extracted_fact_id = f.id
              WHERE d.family_id = $1 AND d.patient_profile_id = $2 AND d.deleted_at IS NULL`,
            [scope.familyId, scope.profileId],
          )
        ).rows[0];
        if (reviewQueue === undefined) {
          throw new ObjectStorageIntegrityError("Profile overview review queue is unavailable");
        }

        const reviewDocuments = await client.query<ProfileOverviewDocumentRow>(
          `SELECT d.id,
                  d.family_id,
                  d.patient_profile_id,
                  d.status,
                  d.original_filename,
                  d.uploaded_at,
                  duplicate.id AS duplicate_of_document_id,
                  duplicate.patient_profile_id AS duplicate_profile_id,
                  COALESCE(blob_type.content_type, b.content_type) AS content_type,
                  b.byte_size,
                  b.sha256,
                  b.storage_key,
                  v.id AS document_version_id,
                  j.id AS job_id,
                  j.state AS job_state,
                  j.current_stage AS job_current_stage,
                  j.last_error_code AS job_last_error_code,
                  j.updated_at AS job_updated_at,
                  r.id AS extraction_run_id,
                  r.status AS extraction_status,
                  intelligence.provider AS intelligence_provider,
                  intelligence.model_id AS intelligence_model_id,
                  intelligence.runtime_version AS intelligence_runtime_version,
                  intelligence.schema_version AS intelligence_schema_version,
                  intelligence.category AS intelligence_category,
                  intelligence.title AS intelligence_title,
                  intelligence.short_summary AS intelligence_short_summary,
                  intelligence.document_date AS intelligence_document_date,
                  intelligence.confidence AS intelligence_confidence,
                  COUNT(f.id) AS fact_count,
                  COALESCE(SUM(CASE WHEN d_review.id IS NULL AND f.id IS NOT NULL THEN 1 ELSE 0 END), 0)
                    AS pending_fact_count,
                  COALESCE(SUM(CASE
                    WHEN d_review.id IS NULL AND f.review_status = 'needs_review' THEN 1
                    ELSE 0
                  END), 0) AS needs_attention_fact_count
             FROM documents d
             JOIN document_versions v
               ON v.family_id = d.family_id AND v.document_id = d.id AND v.version_number = 1
             JOIN document_blobs b
               ON b.family_id = v.family_id AND b.id = v.blob_id
             LEFT JOIN document_blob_content_types blob_type
               ON blob_type.family_id = b.family_id AND blob_type.blob_id = b.id
             LEFT JOIN documents duplicate
               ON duplicate.family_id = d.family_id AND duplicate.id = d.duplicate_of_document_id
              AND duplicate.deleted_at IS NULL
             JOIN extraction_runs r
               ON r.id = (
                 SELECT latest_run.id
                   FROM extraction_runs latest_run
                  WHERE latest_run.family_id = v.family_id
                    AND latest_run.document_version_id = v.id
                  ORDER BY latest_run.created_at DESC, latest_run.id DESC
                  LIMIT 1
               )
              AND r.status = 'awaiting_review'
             LEFT JOIN document_intelligence_results intelligence
               ON intelligence.id = (
                 SELECT latest_intelligence.id
                   FROM document_intelligence_results latest_intelligence
                  WHERE latest_intelligence.family_id = d.family_id
                    AND latest_intelligence.document_version_id = v.id
                  ORDER BY latest_intelligence.created_at DESC, latest_intelligence.id DESC
                  LIMIT 1
               )
             LEFT JOIN processing_jobs j
               ON j.id = (
                 SELECT latest_job.id
                   FROM processing_jobs latest_job
                  WHERE latest_job.family_id = d.family_id
                    AND latest_job.document_version_id = v.id
                    AND latest_job.kind = 'document_extraction'
                  ORDER BY latest_job.created_at DESC, latest_job.id DESC
                  LIMIT 1
               )
             LEFT JOIN extracted_facts f
               ON f.family_id = r.family_id AND f.extraction_run_id = r.id
             LEFT JOIN review_decisions d_review
               ON d_review.family_id = f.family_id AND d_review.extracted_fact_id = f.id
            WHERE d.family_id = $1 AND d.patient_profile_id = $2 AND d.deleted_at IS NULL
            GROUP BY d.id, d.family_id, d.patient_profile_id, d.status, d.original_filename,
                     d.uploaded_at, duplicate.id, duplicate.patient_profile_id,
                     blob_type.content_type, b.content_type, b.byte_size, b.sha256, b.storage_key,
                     v.id, j.id, j.state, j.current_stage, j.last_error_code, j.updated_at,
                     r.id, r.status, intelligence.provider, intelligence.model_id,
                     intelligence.runtime_version, intelligence.schema_version,
                     intelligence.category, intelligence.title, intelligence.short_summary,
                     intelligence.document_date, intelligence.confidence
            ORDER BY d.uploaded_at DESC, d.id DESC
            LIMIT 3`,
          [scope.familyId, scope.profileId],
        );

        const recentObservations = await client.query<ObservationHistoryRow>(
          `SELECT o.id, o.canonical_code, o.source_name, o.source_value, o.source_unit,
                  o.normalized_value, o.normalized_unit, o.conversion_version,
                  o.sampled_at, o.resulted_at, o.uploaded_at, o.specimen_type, o.laboratory,
                  o.source_fragment, o.extraction_confidence, o.confirmed_at,
                  o.confirmed_by_user_id, reviewer.display_name AS confirmed_by_display_name,
                  o.document_id, o.document_version_id, page.page_number,
                  COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) AS timeline_at,
                  reference_range.source_text AS reference_source_text,
                  reference_range.source_low AS reference_source_low,
                  reference_range.source_high AS reference_source_high,
                  reference_range.source_unit AS reference_source_unit,
                  reference_range.laboratory_out_of_range AS reference_laboratory_out_of_range,
                  reference_range.normalized_low AS reference_normalized_low,
                  reference_range.normalized_high AS reference_normalized_high,
                  reference_range.normalized_unit AS reference_normalized_unit,
                  reference_range.conversion_version AS reference_conversion_version
             FROM observations o
             JOIN document_pages page
               ON page.family_id = o.family_id
              AND page.id = o.document_page_id
              AND page.document_version_id = o.document_version_id
             JOIN documents source_document
               ON source_document.family_id = o.family_id
              AND source_document.id = o.document_id
              AND source_document.deleted_at IS NULL
             JOIN users reviewer ON reviewer.id = o.confirmed_by_user_id
             LEFT JOIN observation_reference_ranges reference_range
               ON reference_range.family_id = o.family_id
              AND reference_range.observation_id = o.id
            WHERE o.family_id = $1
              AND o.patient_profile_id = $2
              AND o.status = 'confirmed'
            ORDER BY COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) DESC, o.id DESC
            LIMIT 3`,
          [scope.familyId, scope.profileId],
        );

        const response: ProfileOverviewResponse = {
          contractVersion: PROFILE_OVERVIEW_CONTRACT_VERSION,
          profile: profileOverviewProfile(profile),
          recentDocuments: recentDocuments.rows.map(profileOverviewDocument),
          reviewQueue: {
            documentCount: asCount(reviewQueue.document_count, "overview review document count"),
            pendingFactCount: asCount(
              reviewQueue.pending_fact_count,
              "overview pending fact count",
            ),
            needsAttentionFactCount: asCount(
              reviewQueue.needs_attention_fact_count,
              "overview attention fact count",
            ),
            documents: reviewDocuments.rows.map(profileOverviewReviewDocument),
          },
          recentObservations: recentObservations.rows.map((row) =>
            observationHistoryItem(row, scope),
          ),
        };
        if (response.reviewQueue.needsAttentionFactCount > response.reviewQueue.pendingFactCount) {
          throw new ObjectStorageIntegrityError("Stored overview review counts are invalid");
        }
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "profile.overview.opened",
          resourceType: "PatientProfile",
          resourceId: scope.profileId,
          correlationId,
          createdAt: new Date(),
          contractVersion: PROFILE_OVERVIEW_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async getHealthSummary(actor, requestedScope, requestedQuery, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const requestedVersion = healthSummaryVersion(requestedQuery.version);
      return database.transaction(async (client) => {
        await requireProfileReadAccess(client, actor, scope.familyId, scope.profileId);
        const storedSummary = (
          await client.query<{ id: string }>(
            `SELECT id
               FROM health_summaries
              WHERE family_id = $1 AND patient_profile_id = $2
                AND ($3 IS NULL OR version = $3)
              ORDER BY version DESC
              LIMIT 1`,
            [scope.familyId, scope.profileId, requestedVersion],
          )
        ).rows[0];
        if (requestedVersion !== null && storedSummary === undefined)
          throw new ResourceNotFoundError();
        const rows = await client.query<HealthSummaryRow>(
          `SELECT observation.id,
                  summary.id AS summary_id,
                  summary.version,
                  summary.created_at,
                  summary.previous_summary_id,
                  previous.version AS previous_version,
                  previous.created_at AS previous_created_at,
                  summary.included_evidence_count,
                  summary.available_confirmed_observation_count,
                  summary.missing_data,
                  summary.recommendation_codes,
                  evidence.observation_id,
                  evidence.position,
                  evidence.is_new_since_previous_summary,
                  observation.canonical_code,
                  observation.source_name,
                  observation.source_value,
                  observation.source_unit,
                  observation.normalized_value,
                  observation.normalized_unit,
                  observation.conversion_version,
                  observation.sampled_at,
                  observation.resulted_at,
                  observation.uploaded_at,
                  observation.specimen_type,
                  observation.laboratory,
                  observation.source_fragment,
                  observation.extraction_confidence,
                  observation.confirmed_at,
                  observation.confirmed_by_user_id,
                  reviewer.display_name AS confirmed_by_display_name,
                  observation.document_id,
                  observation.document_version_id,
                  page.page_number,
                  COALESCE(observation.sampled_at, observation.resulted_at, observation.uploaded_at) AS timeline_at,
                  reference_range.source_text AS reference_source_text,
                  reference_range.source_low AS reference_source_low,
                  reference_range.source_high AS reference_source_high,
                  reference_range.source_unit AS reference_source_unit,
                  reference_range.laboratory_out_of_range AS reference_laboratory_out_of_range,
                  reference_range.normalized_low AS reference_normalized_low,
                  reference_range.normalized_high AS reference_normalized_high,
                  reference_range.normalized_unit AS reference_normalized_unit,
                  reference_range.conversion_version AS reference_conversion_version
             FROM health_summaries summary
             JOIN health_summary_evidence evidence
               ON evidence.family_id = summary.family_id AND evidence.health_summary_id = summary.id
             JOIN observations observation
               ON observation.family_id = evidence.family_id AND observation.id = evidence.observation_id
             JOIN document_pages page
               ON page.family_id = observation.family_id
              AND page.id = observation.document_page_id
              AND page.document_version_id = observation.document_version_id
             JOIN users reviewer ON reviewer.id = observation.confirmed_by_user_id
             LEFT JOIN health_summaries previous
               ON previous.family_id = summary.family_id AND previous.id = summary.previous_summary_id
             LEFT JOIN observation_reference_ranges reference_range
               ON reference_range.family_id = observation.family_id
              AND reference_range.observation_id = observation.id
            WHERE summary.family_id = $1
              AND summary.patient_profile_id = $2
              AND summary.id = $3
            ORDER BY evidence.position ASC
            LIMIT $4`,
          [scope.familyId, scope.profileId, storedSummary?.id ?? null, MAX_HEALTH_SUMMARY_EVIDENCE],
        );
        if (storedSummary !== undefined && rows.rows.length === 0) {
          throw new ObjectStorageIntegrityError(
            "Stored health summary has no readable confirmed evidence",
          );
        }
        const response = healthSummaryResponse(scope, rows.rows);
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "profile.health_summary.opened",
          resourceType: "PatientProfile",
          resourceId: scope.profileId,
          correlationId,
          createdAt: new Date(),
          contractVersion: HEALTH_SUMMARY_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async getHealthSummaryHistory(actor, requestedScope, requestedQuery, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const beforeVersion = healthSummaryVersion(requestedQuery.beforeVersion);
      const limit = healthSummaryHistoryLimit(requestedQuery.limit);
      return database.transaction(async (client) => {
        await requireProfileReadAccess(client, actor, scope.familyId, scope.profileId);
        const rows = await client.query<HealthSummaryVersionRow>(
          `SELECT summary.id,
                  summary.version,
                  summary.created_at,
                  summary.included_evidence_count,
                  summary.available_confirmed_observation_count,
                  COUNT(evidence.observation_id) AS actual_evidence_count,
                  SUM(CASE WHEN evidence.is_new_since_previous_summary = 1 THEN 1 ELSE 0 END)
                    AS new_evidence_count
             FROM health_summaries summary
             JOIN health_summary_evidence evidence
               ON evidence.family_id = summary.family_id AND evidence.health_summary_id = summary.id
            WHERE summary.family_id = $1
              AND summary.patient_profile_id = $2
              AND ($3 IS NULL OR summary.version < $3)
            GROUP BY summary.id, summary.version, summary.created_at, summary.included_evidence_count,
                     summary.available_confirmed_observation_count
            ORDER BY summary.version DESC
            LIMIT $4`,
          [scope.familyId, scope.profileId, beforeVersion, limit + 1],
        );
        const pageRows = rows.rows.slice(0, limit);
        const versions = pageRows.map((row) => {
          const includedEvidenceCount = asCount(
            row.included_evidence_count,
            "health summary history evidence count",
          );
          const totalConfirmedObservationCount = asCount(
            row.available_confirmed_observation_count,
            "health summary history confirmed observation count",
          );
          const newEvidenceCount = asCount(
            row.new_evidence_count,
            "health summary history new evidence",
          );
          const actualEvidenceCount = asCount(
            row.actual_evidence_count,
            "health summary history actual evidence count",
          );
          if (
            includedEvidenceCount < 1 ||
            actualEvidenceCount !== includedEvidenceCount ||
            totalConfirmedObservationCount < includedEvidenceCount ||
            newEvidenceCount > includedEvidenceCount
          ) {
            throw new ObjectStorageIntegrityError("Stored health summary history is invalid");
          }
          const version = asCount(row.version, "health summary history version");
          if (version < 1) {
            throw new ObjectStorageIntegrityError(
              "Stored health summary history version is invalid",
            );
          }
          return {
            id: requiredCanonicalUuid(row.id, "health summary history id"),
            version,
            createdAt: canonicalTimestamp(row.created_at),
            includedEvidenceCount,
            totalConfirmedObservationCount,
            newEvidenceCount,
            carriedForwardEvidenceCount: includedEvidenceCount - newEvidenceCount,
          };
        });
        const last = versions.at(-1);
        const response: HealthSummaryHistoryResponse = {
          contractVersion: HEALTH_SUMMARY_HISTORY_CONTRACT_VERSION,
          versions,
          nextBeforeVersion: rows.rows.length > limit && last !== undefined ? last.version : null,
        };
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "profile.health_summary_history.opened",
          resourceType: "PatientProfile",
          resourceId: scope.profileId,
          correlationId,
          createdAt: new Date(),
          contractVersion: HEALTH_SUMMARY_HISTORY_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async getHealthSummaryComparison(actor, requestedScope, requestedQuery, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const { fromVersion, toVersion } = healthSummaryComparisonVersions(requestedQuery);
      return database.transaction(async (client) => {
        await requireProfileReadAccess(client, actor, scope.familyId, scope.profileId);
        const summaries = await client.query<HealthSummarySelectorRow>(
          `SELECT id, version, created_at, included_evidence_count
             FROM health_summaries
            WHERE family_id = $1
              AND patient_profile_id = $2
              AND version IN ($3, $4)
            ORDER BY version ASC`,
          [scope.familyId, scope.profileId, fromVersion, toVersion],
        );
        const baseRow = summaries.rows[0];
        const targetRow = summaries.rows[1];
        if (
          baseRow === undefined ||
          targetRow === undefined ||
          asCount(baseRow.version, "comparison base summary version") !== fromVersion ||
          asCount(targetRow.version, "comparison target summary version") !== toVersion
        ) {
          throw new ResourceNotFoundError();
        }
        const rows = await client.query<ObservationHistoryRow & { summary_version: number }>(
          `SELECT summary.version AS summary_version,
                  observation.id,
                  observation.canonical_code,
                  observation.source_name,
                  observation.source_value,
                  observation.source_unit,
                  observation.normalized_value,
                  observation.normalized_unit,
                  observation.conversion_version,
                  observation.sampled_at,
                  observation.resulted_at,
                  observation.uploaded_at,
                  observation.specimen_type,
                  observation.laboratory,
                  observation.source_fragment,
                  observation.extraction_confidence,
                  observation.confirmed_at,
                  observation.confirmed_by_user_id,
                  reviewer.display_name AS confirmed_by_display_name,
                  observation.document_id,
                  observation.document_version_id,
                  page.page_number,
                  COALESCE(observation.sampled_at, observation.resulted_at, observation.uploaded_at) AS timeline_at,
                  reference_range.source_text AS reference_source_text,
                  reference_range.source_low AS reference_source_low,
                  reference_range.source_high AS reference_source_high,
                  reference_range.source_unit AS reference_source_unit,
                  reference_range.laboratory_out_of_range AS reference_laboratory_out_of_range,
                  reference_range.normalized_low AS reference_normalized_low,
                  reference_range.normalized_high AS reference_normalized_high,
                  reference_range.normalized_unit AS reference_normalized_unit,
                  reference_range.conversion_version AS reference_conversion_version
             FROM health_summaries summary
             JOIN health_summary_evidence evidence
               ON evidence.family_id = summary.family_id AND evidence.health_summary_id = summary.id
             JOIN observations observation
               ON observation.family_id = evidence.family_id AND observation.id = evidence.observation_id
             JOIN document_pages page
               ON page.family_id = observation.family_id
              AND page.id = observation.document_page_id
              AND page.document_version_id = observation.document_version_id
             JOIN users reviewer ON reviewer.id = observation.confirmed_by_user_id
             LEFT JOIN observation_reference_ranges reference_range
               ON reference_range.family_id = observation.family_id
              AND reference_range.observation_id = observation.id
            WHERE summary.family_id = $1
              AND summary.patient_profile_id = $2
              AND summary.version IN ($3, $4)
            ORDER BY summary.version ASC, evidence.position ASC`,
          [scope.familyId, scope.profileId, fromVersion, toVersion],
        );
        const baseEvidence = new Map<string, ObservationHistoryResponse["items"][number]>();
        const targetEvidence = new Map<string, ObservationHistoryResponse["items"][number]>();
        for (const row of rows.rows) {
          const version = asCount(row.summary_version, "comparison evidence version");
          const target =
            version === fromVersion ? baseEvidence : version === toVersion ? targetEvidence : null;
          if (target === null)
            throw new ObjectStorageIntegrityError("Stored comparison evidence is invalid");
          const observation = observationHistoryItem(row, scope);
          if (target.has(observation.id)) {
            throw new ObjectStorageIntegrityError("Stored comparison evidence is duplicated");
          }
          target.set(observation.id, observation);
        }
        const baseCount = asCount(
          baseRow.included_evidence_count,
          "comparison base summary evidence count",
        );
        const targetCount = asCount(
          targetRow.included_evidence_count,
          "comparison target summary evidence count",
        );
        if (
          baseCount < 1 ||
          baseCount > MAX_HEALTH_SUMMARY_EVIDENCE ||
          targetCount < 1 ||
          targetCount > MAX_HEALTH_SUMMARY_EVIDENCE ||
          baseEvidence.size !== baseCount ||
          targetEvidence.size !== targetCount
        ) {
          throw new ObjectStorageIntegrityError(
            "Stored comparison summary has no readable evidence",
          );
        }
        const response: HealthSummaryComparisonResponse = {
          contractVersion: HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION,
          base: {
            id: requiredCanonicalUuid(baseRow.id, "comparison base summary"),
            version: fromVersion,
            createdAt: canonicalTimestamp(baseRow.created_at),
          },
          target: {
            id: requiredCanonicalUuid(targetRow.id, "comparison target summary"),
            version: toVersion,
            createdAt: canonicalTimestamp(targetRow.created_at),
          },
          newlyIncluded: [...targetEvidence.values()].filter(
            (observation) => !baseEvidence.has(observation.id),
          ),
          noLongerIncluded: [...baseEvidence.values()].filter(
            (observation) => !targetEvidence.has(observation.id),
          ),
        };
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "profile.health_summary_comparison.opened",
          resourceType: "PatientProfile",
          resourceId: scope.profileId,
          correlationId,
          createdAt: new Date(),
          contractVersion: HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async getIndicatorCatalog(actor, requestedScope, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      return database.transaction(async (client) => {
        await requireProfileReadAccess(client, actor, scope.familyId, scope.profileId);
        const rows = await client.query<IndicatorCatalogRow>(
          `SELECT o.canonical_code,
                  COALESCE(o.normalized_unit, o.source_unit) AS comparison_unit,
                  COALESCE(o.normalized_value, o.source_value) AS comparison_value,
                  catalog.display_name,
                  COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) AS timeline_at, o.id
             FROM observations o
             JOIN analyte_catalog catalog ON catalog.canonical_code = o.canonical_code
            WHERE o.family_id = $1
              AND o.patient_profile_id = $2
              AND o.status = 'confirmed'
              AND o.canonical_code IS NOT NULL
            ORDER BY o.canonical_code, comparison_unit,
                     COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) DESC,
                     o.confirmed_at DESC, o.id DESC`,
          [scope.familyId, scope.profileId],
        );
        const grouped = new Map<
          string,
          Map<string, { observationCount: number; latest: { value: string; timelineAt: string } }>
        >();
        for (const row of rows.rows) {
          if (!canonicalCodePattern.test(row.canonical_code)) {
            throw new ObjectStorageIntegrityError("Stored observation canonical code is invalid");
          }
          const unit = indicatorUnit(row.comparison_unit);
          const value = requiredBoundedString(
            row.comparison_value,
            100,
            "observation comparison value",
          );
          const timelineAt = canonicalTimestamp(row.timeline_at);
          const units = grouped.get(row.canonical_code) ?? new Map();
          const current = units.get(unit);
          units.set(unit, {
            observationCount: (current?.observationCount ?? 0) + 1,
            latest: current?.latest ?? { value, timelineAt },
          });
          grouped.set(row.canonical_code, units);
        }
        const response: IndicatorCatalogResponse = {
          contractVersion: INDICATOR_SERIES_CONTRACT_VERSION,
          items: [...grouped.entries()].map(([canonicalCode, units]) => {
            const displayNames = new Set(
              rows.rows
                .filter((row) => row.canonical_code === canonicalCode)
                .map((row) => requiredBoundedString(row.display_name, 200, "indicator name")),
            );
            if (displayNames.size !== 1) {
              throw new ObjectStorageIntegrityError("Stored indicator names are inconsistent");
            }
            const displayName = displayNames.values().next().value;
            if (displayName === undefined) {
              throw new ObjectStorageIntegrityError("Stored indicator name is missing");
            }
            return {
              canonicalCode,
              displayName,
              units: [...units.entries()].map(([unit, summary]) => ({ unit, ...summary })),
            };
          }),
        };
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "indicator.catalog.opened",
          resourceType: "PatientProfile",
          resourceId: scope.profileId,
          correlationId,
          createdAt: new Date(),
          contractVersion: INDICATOR_SERIES_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async getIndicatorSeries(actor, requestedScope, requestedQuery, correlationId) {
      const profileScope = canonicalProfileScope(requestedScope);
      const canonicalCode = historyCanonicalCode(requestedScope.canonicalCode);
      if (canonicalCode === null) throw new ResourceNotFoundError();
      const unit = indicatorUnit(requestedQuery.unit);
      const limit = indicatorSeriesLimit(requestedQuery.limit);
      return database.transaction(async (client) => {
        await requireProfileReadAccess(
          client,
          actor,
          profileScope.familyId,
          profileScope.profileId,
        );
        const indicator = (
          await client.query<{ display_name: string }>(
            "SELECT display_name FROM analyte_catalog WHERE canonical_code = $1",
            [canonicalCode],
          )
        ).rows[0];
        if (indicator === undefined) throw new ResourceNotFoundError();
        const cursor = decodeIndicatorSeriesCursor(requestedQuery.cursor, canonicalCode, unit);
        const comparisonRows = await client.query<ObservationHistoryRow>(
          `SELECT o.id, o.canonical_code, o.source_name, o.source_value, o.source_unit,
                  o.normalized_value, o.normalized_unit, o.conversion_version,
                  o.sampled_at, o.resulted_at, o.uploaded_at, o.specimen_type, o.laboratory,
                  o.source_fragment, o.extraction_confidence, o.confirmed_at,
                  o.confirmed_by_user_id, reviewer.display_name AS confirmed_by_display_name,
                  o.document_id, o.document_version_id, page.page_number,
                  COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) AS timeline_at,
                  reference_range.source_text AS reference_source_text,
                  reference_range.source_low AS reference_source_low,
                  reference_range.source_high AS reference_source_high,
                  reference_range.source_unit AS reference_source_unit,
                  reference_range.laboratory_out_of_range AS reference_laboratory_out_of_range,
                  reference_range.normalized_low AS reference_normalized_low,
                  reference_range.normalized_high AS reference_normalized_high,
                  reference_range.normalized_unit AS reference_normalized_unit,
                  reference_range.conversion_version AS reference_conversion_version
             FROM observations o
             JOIN document_pages page
               ON page.family_id = o.family_id
              AND page.id = o.document_page_id
              AND page.document_version_id = o.document_version_id
             JOIN users reviewer ON reviewer.id = o.confirmed_by_user_id
             LEFT JOIN observation_reference_ranges reference_range
               ON reference_range.family_id = o.family_id
              AND reference_range.observation_id = o.id
            WHERE o.family_id = $1
              AND o.patient_profile_id = $2
              AND o.status = 'confirmed'
              AND o.canonical_code = $3
              AND COALESCE(o.normalized_unit, o.source_unit) = $4
            ORDER BY COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) DESC,
                     o.confirmed_at DESC, o.id DESC
            LIMIT 2`,
          [profileScope.familyId, profileScope.profileId, canonicalCode, unit],
        );
        const observations = await client.query<ObservationHistoryRow>(
          `SELECT o.id, o.canonical_code, o.source_name, o.source_value, o.source_unit,
                  o.normalized_value, o.normalized_unit, o.conversion_version,
                  o.sampled_at, o.resulted_at, o.uploaded_at, o.specimen_type, o.laboratory,
                  o.source_fragment, o.extraction_confidence, o.confirmed_at,
                  o.confirmed_by_user_id, reviewer.display_name AS confirmed_by_display_name,
                  o.document_id, o.document_version_id, page.page_number,
                  COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) AS timeline_at,
                  reference_range.source_text AS reference_source_text,
                  reference_range.source_low AS reference_source_low,
                  reference_range.source_high AS reference_source_high,
                  reference_range.source_unit AS reference_source_unit,
                  reference_range.laboratory_out_of_range AS reference_laboratory_out_of_range,
                  reference_range.normalized_low AS reference_normalized_low,
                  reference_range.normalized_high AS reference_normalized_high,
                  reference_range.normalized_unit AS reference_normalized_unit,
                  reference_range.conversion_version AS reference_conversion_version
             FROM observations o
             JOIN document_pages page
               ON page.family_id = o.family_id
              AND page.id = o.document_page_id
              AND page.document_version_id = o.document_version_id
             JOIN users reviewer ON reviewer.id = o.confirmed_by_user_id
             LEFT JOIN observation_reference_ranges reference_range
               ON reference_range.family_id = o.family_id
              AND reference_range.observation_id = o.id
            WHERE o.family_id = $1
              AND o.patient_profile_id = $2
              AND o.status = 'confirmed'
              AND o.canonical_code = $3
              AND COALESCE(o.normalized_unit, o.source_unit) = $4
              AND (
                $5 IS NULL
                OR COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) < $5
                OR (
                  COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) = $5
                  AND o.confirmed_at < $6
                )
                OR (
                  COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) = $5
                  AND o.confirmed_at = $6
                  AND o.id < $7
                )
              )
            ORDER BY COALESCE(o.sampled_at, o.resulted_at, o.uploaded_at) DESC,
                     o.confirmed_at DESC, o.id DESC
            LIMIT $8`,
          [
            profileScope.familyId,
            profileScope.profileId,
            canonicalCode,
            unit,
            cursor?.timelineAt ?? null,
            cursor?.confirmedAt ?? null,
            cursor?.id ?? null,
            limit + 1,
          ],
        );
        const pageRows = observations.rows.slice(0, limit);
        const items = pageRows.map((row) => observationHistoryItem(row, profileScope));
        const lastItem = items.at(-1);
        const nextCursor =
          observations.rows.length > limit && lastItem !== undefined
            ? encodeIndicatorSeriesCursor({
                canonicalCode,
                unit,
                id: lastItem.id,
                timelineAt: lastItem.timelineAt,
                confirmedAt: lastItem.confirmed.at,
              })
            : null;
        const first = comparisonRows.rows[0]
          ? observationHistoryItem(comparisonRows.rows[0], profileScope)
          : undefined;
        const second = comparisonRows.rows[1]
          ? observationHistoryItem(comparisonRows.rows[1], profileScope)
          : undefined;
        const comparison: IndicatorComparison =
          first === undefined || second === undefined
            ? { state: "insufficient_data" }
            : (() => {
                const delta = decimalDelta(
                  first.normalized.value ?? first.source.value,
                  second.normalized.value ?? second.source.value,
                );
                if (delta === null)
                  return { state: "unavailable", reason: "non_numeric_source_value" };
                return {
                  state: "available",
                  previous: {
                    id: second.id,
                    value: second.normalized.value ?? second.source.value,
                    timelineAt: second.timelineAt,
                  },
                  delta,
                };
              })();
        const response: IndicatorSeriesResponse = {
          contractVersion: INDICATOR_SERIES_CONTRACT_VERSION,
          indicator: {
            canonicalCode,
            displayName: requiredBoundedString(indicator.display_name, 200, "indicator name"),
            unit,
          },
          items,
          comparison,
          nextCursor,
        };
        await audit(client, {
          familyId: profileScope.familyId,
          actorUserId: actor.userId,
          action: "indicator.series.opened",
          resourceType: "PatientProfile",
          resourceId: profileScope.profileId,
          correlationId,
          createdAt: new Date(),
          contractVersion: INDICATOR_SERIES_CONTRACT_VERSION,
        });
        return response;
      });
    },

    async reviewFact(actor, requestedScope, input, idempotencyKey, correlationId) {
      const scope = canonicalFactScope(requestedScope);
      const command = validateFactReviewCommand(input);
      const keyHash = sha256(idempotencyKey);
      const commandHash = reviewRequestHash(scope.factId, command);
      return database.transaction(async (client) => {
        const document = await documentRow(client, actor, scope, "write");
        const fact = (
          await client.query<FactForReviewRow>(
            `SELECT f.id, f.document_version_id, f.document_page_id, f.extraction_run_id,
                    f.source_fragment, f.source_name, f.source_value, f.source_unit,
                    f.proposed_canonical_code, f.proposed_normalized_value,
                    f.proposed_normalized_unit, f.proposed_reference_range,
                    f.proposed_specimen, f.proposed_sampled_at, f.proposed_resulted_at,
                    f.proposed_laboratory, f.confidence
               FROM extracted_facts f
               JOIN extraction_runs r
                 ON r.family_id = f.family_id AND r.id = f.extraction_run_id
              WHERE f.family_id = $1
                AND f.id = $2
                AND f.document_version_id = $3
                AND r.document_version_id = f.document_version_id
                AND r.status IN ('awaiting_review', 'completed')
                AND r.id = (
                  SELECT latest_run.id
                    FROM extraction_runs latest_run
                   WHERE latest_run.family_id = f.family_id
                     AND latest_run.document_version_id = f.document_version_id
                   ORDER BY latest_run.created_at DESC, latest_run.id DESC
                   LIMIT 1
                )`,
            [scope.familyId, scope.factId, document.document_version_id],
          )
        ).rows[0];
        if (fact === undefined) throw new ResourceNotFoundError();

        const replay = (
          await client.query<ReviewRequestRow>(
            `SELECT rr.extracted_fact_id, rr.request_hash, d.id AS decision_id,
                    d.source_fact_version, d.outcome, d.decided_at,
                    d.decided_by_user_id, reviewer.display_name AS decided_by_display_name,
                    d.observation_id
               FROM review_requests rr
               JOIN review_decisions d
                 ON d.family_id = rr.family_id AND d.id = rr.review_decision_id
               JOIN users reviewer ON reviewer.id = d.decided_by_user_id
              WHERE rr.family_id = $1
                AND rr.actor_user_id = $2
                AND rr.idempotency_key_hash = $3`,
            [scope.familyId, actor.userId, keyHash],
          )
        ).rows[0];
        if (replay !== undefined) {
          if (replay.extracted_fact_id !== fact.id || replay.request_hash !== commandHash) {
            throw new IdempotencyConflictError();
          }
          const response = factReviewResponse({
            id: replay.decision_id,
            extracted_fact_id: replay.extracted_fact_id,
            source_fact_version: replay.source_fact_version,
            outcome: replay.outcome,
            decided_at: replay.decided_at,
            decided_by_user_id: replay.decided_by_user_id,
            decided_by_display_name: replay.decided_by_display_name,
            observation_id: replay.observation_id,
          });
          await audit(client, {
            familyId: scope.familyId,
            actorUserId: actor.userId,
            action: "document.fact.review.replayed",
            resourceType: "ExtractedFact",
            resourceId: fact.id,
            correlationId,
            createdAt: new Date(),
          });
          return { response, replayed: true };
        }

        const existing = (
          await client.query<ReviewDecisionRow>(
            `SELECT d.id, d.extracted_fact_id, d.source_fact_version, d.outcome, d.decided_at,
                    d.decided_by_user_id, reviewer.display_name AS decided_by_display_name,
                    d.observation_id
               FROM review_decisions d
               JOIN users reviewer ON reviewer.id = d.decided_by_user_id
              WHERE d.family_id = $1 AND d.extracted_fact_id = $2`,
            [scope.familyId, fact.id],
          )
        ).rows[0];
        if (existing !== undefined) throw new DomainConflictError();

        const now = new Date();
        const timestamp = now.toISOString();
        const decisionId = randomUUID();
        const observationId = command.decision === "reject" ? null : randomUUID();
        const sourceName =
          command.decision === "correct"
            ? command.correction?.sourceName
            : requiredBoundedString(fact.source_name, 200, "fact source name");
        const sourceValue =
          command.decision === "correct"
            ? command.correction?.sourceValue
            : requiredBoundedString(fact.source_value, 100, "fact source value");
        const sourceUnit =
          command.decision === "correct"
            ? command.correction?.sourceUnit
            : requiredBoundedString(fact.source_unit, 100, "fact source unit");
        if (
          command.decision !== "reject" &&
          (sourceName === undefined || sourceValue === undefined || sourceUnit === undefined)
        ) {
          throw new DomainValidationError();
        }

        const mappedAnalyte = await resolveAnalyteMapping(client, {
          sourceName: fact.source_name,
          sourceUnit: fact.source_unit,
          sourceValue: fact.source_value,
          proposedLaboratory: fact.proposed_laboratory,
          proposedNormalizedValue: fact.proposed_normalized_value,
        });
        const canonicalCode = nullableBoundedString(
          mappedAnalyte?.canonicalCode ?? fact.proposed_canonical_code,
          100,
          "fact canonical code",
        );
        const normalizedValue =
          command.decision === "correct"
            ? null
            : nullableBoundedString(
                mappedAnalyte?.normalizedValue ?? fact.proposed_normalized_value,
                100,
                "fact normalized value",
              );
        const normalizedUnit =
          command.decision === "correct"
            ? null
            : nullableBoundedString(
                mappedAnalyte?.normalizedUnit ?? fact.proposed_normalized_unit,
                100,
                "fact normalized unit",
              );
        if ((normalizedValue === null) !== (normalizedUnit === null)) {
          throw new ObjectStorageIntegrityError("Stored fact normalization is invalid");
        }
        const conversionVersion =
          normalizedValue === null
            ? null
            : mappedAnalyte === null
              ? CODEX_DOCUMENT_INTELLIGENCE_VERSION
              : "analyte-alias/v1";
        const reference =
          fact.proposed_reference_range === null
            ? null
            : referenceRange(fact.proposed_reference_range);
        const sampledAt = nullableCanonicalTimestamp(fact.proposed_sampled_at, "fact sampled time");
        const resultedAt = nullableCanonicalTimestamp(
          fact.proposed_resulted_at,
          "fact result time",
        );
        const specimenType = nullableBoundedString(fact.proposed_specimen, 200, "fact specimen");
        const laboratory = nullableBoundedString(fact.proposed_laboratory, 200, "fact laboratory");
        const confidence = Number(fact.confidence);
        if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
          throw new ObjectStorageIntegrityError("Stored fact confidence is invalid");
        }

        if (observationId !== null) {
          await client.query(
            `INSERT INTO observations
               (id, family_id, patient_profile_id, document_id, document_version_id,
                document_page_id, source_extracted_fact_id, source_fact_version,
                review_decision_id, status, canonical_code, source_name, source_value,
                source_unit, normalized_value, normalized_unit, conversion_version,
                sampled_at, resulted_at, uploaded_at, specimen_type, laboratory,
                source_fragment, extraction_confidence, confirmed_by_user_id,
                confirmed_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, 'confirmed',
                     $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                     $20, $21, $22, $23, $24, $24)`,
            [
              observationId,
              scope.familyId,
              document.patient_profile_id,
              document.id,
              document.document_version_id,
              fact.document_page_id,
              fact.id,
              decisionId,
              canonicalCode,
              sourceName,
              sourceValue,
              sourceUnit,
              normalizedValue,
              normalizedUnit,
              conversionVersion,
              sampledAt,
              resultedAt,
              canonicalTimestamp(document.uploaded_at),
              specimenType,
              laboratory,
              requiredBoundedString(fact.source_fragment, 4_000, "fact source fragment"),
              confidence,
              actor.userId,
              timestamp,
            ],
          );
        }

        await client.query(
          `INSERT INTO review_decisions
             (id, family_id, extracted_fact_id, source_fact_version, outcome,
              corrected_source_name, corrected_source_value, corrected_source_unit,
              observation_id, decided_by_user_id, decided_at, created_at)
           VALUES ($1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [
            decisionId,
            scope.familyId,
            fact.id,
            command.decision,
            command.correction?.sourceName ?? null,
            command.correction?.sourceValue ?? null,
            command.correction?.sourceUnit ?? null,
            observationId,
            actor.userId,
            timestamp,
          ],
        );

        if (observationId !== null && reference !== null) {
          await client.query(
            `INSERT INTO observation_reference_ranges
               (id, family_id, observation_id, source_text, source_low, source_high,
                source_unit, laboratory_out_of_range, normalized_low, normalized_high,
                normalized_unit, conversion_version, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, NULL, NULL, $9)`,
            [
              randomUUID(),
              scope.familyId,
              observationId,
              reference.sourceText,
              reference.sourceLow,
              reference.sourceHigh,
              reference.sourceUnit,
              reference.laboratoryOutOfRange,
              timestamp,
            ],
          );
        }

        await client.query(
          `INSERT INTO review_requests
             (id, family_id, actor_user_id, extracted_fact_id, review_decision_id,
              idempotency_key_hash, request_hash, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            scope.familyId,
            actor.userId,
            fact.id,
            decisionId,
            keyHash,
            commandHash,
            timestamp,
          ],
        );

        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.fact.reviewed",
          resourceType: "ExtractedFact",
          resourceId: fact.id,
          correlationId,
          createdAt: now,
        });
        const completedRun = await client.query(
          `UPDATE extraction_runs
              SET status = 'completed'
            WHERE family_id = $1 AND id = $2 AND status = 'awaiting_review'
              AND NOT EXISTS (
                SELECT 1
                  FROM extracted_facts f
                  LEFT JOIN review_decisions d
                    ON d.family_id = f.family_id AND d.extracted_fact_id = f.id
                 WHERE f.family_id = $1
                   AND f.extraction_run_id = $2
                   AND d.id IS NULL
              )`,
          [scope.familyId, fact.extraction_run_id],
        );
        if (completedRun.rowCount === 1) {
          await createHealthSummaryIfNeeded(client, {
            familyId: scope.familyId,
            profileId: document.patient_profile_id,
            extractionRunId: fact.extraction_run_id,
            actorUserId: actor.userId,
            correlationId,
            now,
          });
        }
        return {
          response: factReviewResponse({
            id: decisionId,
            extracted_fact_id: fact.id,
            source_fact_version: 1,
            outcome: command.decision,
            decided_at: timestamp,
            decided_by_user_id: actor.userId,
            decided_by_display_name: actor.displayName,
            observation_id: observationId,
          }),
          replayed: false,
        };
      });
    },

    async retryProcessing(actor, requestedScope, idempotencyKey, correlationId) {
      const scope = canonicalDocumentScope(requestedScope);
      const keyHash = sha256(idempotencyKey);
      return database.transaction(async (client) => {
        const row = await documentRow(client, actor, scope, "write");
        const replay = await client.query<RetryRequestRow>(
          `SELECT document_version_id, created_at
             FROM processing_retry_requests
            WHERE family_id = $1 AND actor_user_id = $2 AND idempotency_key_hash = $3`,
          [scope.familyId, actor.userId, keyHash],
        );
        const previous = replay.rows[0];
        if (previous !== undefined) {
          if (previous.document_version_id !== row.document_version_id) {
            throw new IdempotencyConflictError();
          }
          return {
            contractVersion: DOCUMENT_CONTRACT_VERSION,
            documentId: row.id,
            processing: { state: "queued", updatedAt: canonicalTimestamp(previous.created_at) },
          };
        }

        const job = (
          await client.query<ProcessingJobRow>(
            `SELECT id, state, current_stage, last_error_code, updated_at
               FROM processing_jobs
              WHERE family_id = $1 AND document_version_id = $2
              ORDER BY created_at DESC, id DESC
              LIMIT 1`,
            [scope.familyId, row.document_version_id],
          )
        ).rows[0];
        if (job === undefined || job.state !== "dead_letter") {
          throw new ProcessingNotAvailableError();
        }
        const now = new Date();
        await client.query(
          `INSERT INTO processing_retry_requests
             (id, family_id, actor_user_id, document_version_id, processing_job_id,
              idempotency_key_hash, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            scope.familyId,
            actor.userId,
            row.document_version_id,
            job.id,
            keyHash,
            now,
          ],
        );
        await resetDeadLetterJob(
          client,
          {
            familyId: scope.familyId,
            documentVersionId: row.document_version_id,
            jobId: job.id,
          },
          now,
        );
        const processing = await processingForDocument(client, row);
        if (processing.state !== "queued") throw new ProcessingNotAvailableError();
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.processing.requeued",
          resourceId: scope.documentId,
          correlationId,
          createdAt: now,
        });
        return {
          contractVersion: DOCUMENT_CONTRACT_VERSION,
          documentId: row.id,
          processing,
        };
      });
    },

    async restartProcessing(actor, requestedScope, idempotencyKey, correlationId) {
      const scope = canonicalDocumentScope(requestedScope);
      const keyHash = sha256(idempotencyKey);
      return database.transaction(async (client) => {
        const row = await documentRow(client, actor, scope, "write");
        const replay = await client.query<RetryRequestRow>(
          `SELECT document_version_id, created_at
             FROM processing_restart_requests
            WHERE family_id = $1 AND actor_user_id = $2 AND idempotency_key_hash = $3`,
          [scope.familyId, actor.userId, keyHash],
        );
        const previous = replay.rows[0];
        if (previous !== undefined) {
          if (previous.document_version_id !== row.document_version_id) {
            throw new IdempotencyConflictError();
          }
          return {
            contractVersion: DOCUMENT_CONTRACT_VERSION,
            documentId: row.id,
            processing: { state: "queued", updatedAt: canonicalTimestamp(previous.created_at) },
          };
        }

        const latestJob = (
          await client.query<{ state: string }>(
            `SELECT state
               FROM processing_jobs
              WHERE family_id = $1 AND document_version_id = $2
              ORDER BY created_at DESC, id DESC
              LIMIT 1`,
            [scope.familyId, row.document_version_id],
          )
        ).rows[0];
        if (
          latestJob === undefined ||
          (latestJob.state !== "succeeded" && latestJob.state !== "dead_letter")
        ) {
          throw new ProcessingNotAvailableError();
        }

        const now = new Date();
        const requestId = randomUUID();
        const job = await enqueueDocumentReanalysisInTransaction(client, {
          familyId: scope.familyId,
          documentVersionId: row.document_version_id,
          requestId,
          now,
        });
        await client.query(
          `INSERT INTO processing_restart_requests
             (id, family_id, actor_user_id, document_version_id, processing_job_id,
              idempotency_key_hash, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [requestId, scope.familyId, actor.userId, row.document_version_id, job.id, keyHash, now],
        );
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.processing.restarted",
          resourceId: scope.documentId,
          correlationId,
          createdAt: now,
        });
        return {
          contractVersion: DOCUMENT_CONTRACT_VERSION,
          documentId: row.id,
          processing: { state: "queued", updatedAt: now.toISOString() },
        };
      });
    },

    async getContent(actor, requestedScope, correlationId) {
      const scope = canonicalDocumentScope(requestedScope);
      return database.transaction(async (client) => {
        const row = await documentRow(client, actor, scope);
        const key = createObjectStorageKey(row.storage_key);
        const expected = {
          contentType: row.content_type,
          byteSize: byteSize(row.byte_size),
          sha256: row.sha256,
        };
        const stored = await storage.get(key, expected);
        if (!metadataMatches(stored.metadata, expected)) {
          throw new ObjectStorageIntegrityError(
            "Document metadata does not match immutable storage",
          );
        }
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.content.opened",
          resourceId: scope.documentId,
          correlationId,
          createdAt: new Date(),
        });
        return {
          body: stored.body,
          byteSize: stored.metadata.byteSize,
          contentType: row.content_type,
          originalFilename: row.original_filename,
        };
      });
    },

    async getEvidenceBundle(actor, requestedScope, correlationId) {
      return createProfileArchive(actor, requestedScope, correlationId, {
        contractVersion: SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION,
        action: "profile.evidence_bundle.exported",
        maximumDocuments: MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS,
        failWhenOverLimit: false,
      });
    },

    async getPortableProfileExport(actor, requestedScope, correlationId) {
      return createProfileArchive(actor, requestedScope, correlationId, {
        contractVersion: SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION,
        action: "profile.portable_export.exported",
        maximumDocuments: MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS,
        failWhenOverLimit: true,
      });
    },
  };
}
