import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  DOCUMENT_CONTRACT_VERSION,
  type DocumentFactsResponse,
  type DocumentProcessingResponse,
  type DocumentProcessingRetryResponse,
  type DocumentProcessingStatus,
  type DocumentSummary,
  type FactReviewCommand,
  type FactReviewOutcome,
  type FactReviewResponse,
  LAB_EXTRACTION_SCHEMA_VERSION,
  type LabFactReferenceRange,
  type LabFactValidationIssue,
  OBJECT_STORAGE_CONTRACT_VERSION,
} from "@veylta/contracts";
import type { Database, DatabaseClient, QueryResult } from "../database/pool.js";
import {
  DomainConflictError,
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import { enqueueDocumentExtractionInTransaction } from "../processing/processing-job-service.js";
import {
  createObjectStorageKey,
  type ObjectMetadata,
  type ObjectStorage,
  ObjectStorageIntegrityError,
  type ObjectStorageKey,
  ObjectStorageSizeLimitError,
  type StagedObjectMetadata,
} from "../storage/object-storage.js";

export class UnsupportedDocumentTypeError extends Error {}
export class InvalidPdfSignatureError extends Error {}
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
}

export interface DocumentService {
  acceptUpload(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    staged: StagedDocument,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<DocumentSummary>;
  discardStaged(staged: StagedDocument): Promise<void>;
  getContent(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    correlationId: string,
  ): Promise<DocumentContent>;
  getDocument(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    correlationId: string,
  ): Promise<DocumentSummary>;
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
  requireProfileAccess(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
  ): Promise<void>;
  stagePdf(input: {
    body: Readable;
    contentType: string;
    filename: string | undefined;
  }): Promise<StagedDocument>;
}

export interface DocumentServiceOptions {
  maxPdfBytes: number;
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
  content_type: "application/pdf";
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
  review_observation_id: string | null;
  corrected_source_name: string | null;
  corrected_source_value: string | null;
  corrected_source_unit: string | null;
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
  observation_id: string | null;
}

interface ReviewDecisionRow {
  id: string;
  extracted_fact_id: string;
  source_fact_version: number;
  outcome: string;
  decided_at: string;
  observation_id: string | null;
}

interface ExtractionRunForFactsRow {
  id: string;
  extractor_version: string;
  status: string;
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

interface BlobRow {
  id: string;
  storage_key: string;
  content_type: "application/pdf";
  byte_size: number;
  sha256: string;
}

const pdfSignature = Buffer.from("%PDF-");

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

function safeFilename(value: string | undefined): string {
  const leaf = (value ?? "").split(/[\\/]/).at(-1) ?? "";
  const cleaned = [...leaf]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  const bounded = [...cleaned].slice(0, 255).join("");
  return bounded.length === 0 ? "document.pdf" : bounded;
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
    case "UNSUPPORTED_DOCUMENT":
      return "unsupported_document";
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

function summary(
  row: DocumentRow,
  processing: DocumentProcessingStatus = { state: "not_started" },
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
  };
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

async function* verifiedPdfBytes(body: Readable): AsyncGenerator<Buffer> {
  let prefix = Buffer.alloc(0);
  let verified = false;

  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (verified) {
      yield bytes;
      continue;
    }
    const needed = pdfSignature.byteLength - prefix.byteLength;
    prefix = Buffer.concat([prefix, bytes.subarray(0, needed)]);
    if (prefix.byteLength < pdfSignature.byteLength) continue;
    if (!prefix.equals(pdfSignature)) {
      body.resume();
      throw new InvalidPdfSignatureError();
    }
    verified = true;
    yield prefix;
    const remainder = bytes.subarray(needed);
    if (remainder.byteLength > 0) yield remainder;
  }
  if (!verified) throw new InvalidPdfSignatureError();
}

async function requireProfileAccess(
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
       AND m.role = 'owner'`,
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
      { contractVersion: DOCUMENT_CONTRACT_VERSION },
      event.createdAt,
    ],
  );
}

async function documentRow(
  client: Queryable,
  actor: SessionActor,
  scope: { familyId: string; profileId: string; documentId: string },
): Promise<DocumentRow> {
  const result = await client.query<DocumentRow>(
    `SELECT d.id,
            d.family_id,
            d.patient_profile_id,
            d.status,
            d.original_filename,
            d.uploaded_at,
            d.duplicate_of_document_id,
            duplicate.patient_profile_id AS duplicate_profile_id,
            b.content_type,
            b.byte_size,
            b.sha256,
            b.storage_key,
            v.id AS document_version_id
     FROM documents d
     JOIN family_memberships m
       ON m.family_id = d.family_id
      AND m.user_id = $4
      AND m.status = 'active'
      AND m.role = 'owner'
     JOIN document_versions v
       ON v.family_id = d.family_id
      AND v.document_id = d.id
      AND v.version_number = 1
     JOIN document_blobs b
       ON b.family_id = v.family_id
      AND b.id = v.blob_id
     LEFT JOIN documents duplicate
       ON duplicate.family_id = d.family_id
      AND duplicate.id = d.duplicate_of_document_id
     WHERE d.family_id = $1
       AND d.patient_profile_id = $2
       AND d.id = $3`,
    [scope.familyId, scope.profileId, scope.documentId, actor.userId],
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
}

export function createDocumentService(
  database: Database,
  storage: ObjectStorage,
  options: DocumentServiceOptions,
): DocumentService {
  if (!Number.isSafeInteger(options.maxPdfBytes) || options.maxPdfBytes < pdfSignature.byteLength) {
    throw new Error("maxPdfBytes must fit a PDF signature");
  }

  return {
    async requireProfileAccess(actor, requestedScope) {
      const scope = canonicalProfileScope(requestedScope);
      await requireProfileAccess(database, actor, scope.familyId, scope.profileId);
    },

    async stagePdf(input) {
      if (input.contentType.toLowerCase() !== "application/pdf") {
        input.body.resume();
        throw new UnsupportedDocumentTypeError();
      }
      try {
        const metadata = await storage.putStaging({
          key: stagingObjectKey(),
          body: Readable.from(verifiedPdfBytes(input.body)),
          contentType: "application/pdf",
          maxBytes: options.maxPdfBytes,
        });
        return { metadata, originalFilename: safeFilename(input.filename) };
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
            await requireProfileAccess(client, actor, scope.familyId, scope.profileId);

            const replay = await client.query<UploadRequestRow>(
              `SELECT document_id,
                    patient_profile_id,
                    request_byte_size,
                    request_content_type,
                    request_sha256
             FROM document_upload_requests
             WHERE family_id = $1
               AND actor_user_id = $2
               AND idempotency_key_hash = $3`,
              [scope.familyId, actor.userId, keyHash],
            );
            const previous = replay.rows[0];
            if (previous !== undefined) {
              if (
                previous.patient_profile_id !== scope.profileId ||
                previous.request_sha256 !== staged.metadata.sha256 ||
                previous.request_content_type !== staged.metadata.contentType ||
                byteSize(previous.request_byte_size) !== staged.metadata.byteSize
              ) {
                throw new IdempotencyConflictError();
              }
              const replayed = await documentRow(client, actor, {
                ...scope,
                documentId: previous.document_id,
              });
              await audit(client, {
                familyId: scope.familyId,
                actorUserId: actor.userId,
                action: "document.upload.replayed",
                resourceId: replayed.id,
                correlationId,
                createdAt: new Date(),
              });
              return replayed;
            }

            const existingBlobs = await client.query<BlobRow>(
              `SELECT id, storage_key, content_type, byte_size, sha256
             FROM document_blobs
             WHERE family_id = $1 AND sha256 = $2`,
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
                content_type: "application/pdf",
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
                  blob.content_type,
                  staged.metadata.byteSize,
                  blob.sha256,
                ],
              );
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

            const duplicate = await client.query<{
              id: string;
              patient_profile_id: string;
            }>(
              `SELECT d.id, d.patient_profile_id
             FROM document_versions v
             JOIN documents d
               ON d.family_id = v.family_id
              AND d.id = v.document_id
             WHERE v.family_id = $1 AND v.blob_id = $2
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
                staged.metadata.contentType,
                staged.metadata.byteSize,
                documentId,
                uploadedAt,
              ],
            );
            await audit(client, {
              familyId: scope.familyId,
              actorUserId: actor.userId,
              action: "document.upload.received",
              resourceId: documentId,
              correlationId,
              createdAt: now,
            });
            return {
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
            } satisfies DocumentRow;
          })
          .then((row) => summary(row, { state: "queued", updatedAt: row.uploaded_at }));
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
        return summary(row, await processingForDocument(client, row));
      });
    },

    async getProcessing(actor, requestedScope, correlationId) {
      const scope = canonicalDocumentScope(requestedScope);
      return database.transaction(async (client) => {
        const row = await documentRow(client, actor, scope);
        const processing = await processingForDocument(client, row);
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
                  d.observation_id AS review_observation_id,
                  d.corrected_source_name, d.corrected_source_value,
                  d.corrected_source_unit
             FROM extracted_facts f
             JOIN document_pages p
               ON p.family_id = f.family_id AND p.id = f.document_page_id
             LEFT JOIN review_decisions d
               ON d.family_id = f.family_id AND d.extracted_fact_id = f.id
            WHERE f.family_id = $1 AND f.extraction_run_id = $2
            ORDER BY p.page_number, f.fact_key`,
          [scope.familyId, run.id],
        );
        const response = factResponse(run, facts.rows);
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

    async reviewFact(actor, requestedScope, input, idempotencyKey, correlationId) {
      const scope = canonicalFactScope(requestedScope);
      const command = validateFactReviewCommand(input);
      const keyHash = sha256(idempotencyKey);
      const commandHash = reviewRequestHash(scope.factId, command);
      return database.transaction(async (client) => {
        const document = await documentRow(client, actor, scope);
        const fact = (
          await client.query<FactForReviewRow>(
            `SELECT f.id, f.document_version_id, f.document_page_id, f.extraction_run_id,
                    f.source_fragment, f.source_name, f.source_value, f.source_unit,
                    f.proposed_canonical_code, f.proposed_reference_range,
                    f.proposed_specimen, f.proposed_sampled_at, f.proposed_resulted_at,
                    f.proposed_laboratory, f.confidence
               FROM extracted_facts f
               JOIN extraction_runs r
                 ON r.family_id = f.family_id AND r.id = f.extraction_run_id
              WHERE f.family_id = $1
                AND f.id = $2
                AND f.document_version_id = $3
                AND r.document_version_id = f.document_version_id
                AND r.status IN ('awaiting_review', 'completed')`,
            [scope.familyId, scope.factId, document.document_version_id],
          )
        ).rows[0];
        if (fact === undefined) throw new ResourceNotFoundError();

        const replay = (
          await client.query<ReviewRequestRow>(
            `SELECT rr.extracted_fact_id, rr.request_hash, d.id AS decision_id,
                    d.source_fact_version, d.outcome, d.decided_at, d.observation_id
               FROM review_requests rr
               JOIN review_decisions d
                 ON d.family_id = rr.family_id AND d.id = rr.review_decision_id
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
            `SELECT id, extracted_fact_id, source_fact_version, outcome, decided_at, observation_id
               FROM review_decisions
              WHERE family_id = $1 AND extracted_fact_id = $2`,
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

        const canonicalCode = nullableBoundedString(
          fact.proposed_canonical_code,
          100,
          "fact canonical code",
        );
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
                     $9, $10, $11, $12, NULL, NULL, NULL, $13, $14, $15, $16,
                     $17, $18, $19, $20, $21, $21)`,
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
        await client.query(
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
        return {
          response: factReviewResponse({
            id: decisionId,
            extracted_fact_id: fact.id,
            source_fact_version: 1,
            outcome: command.decision,
            decided_at: timestamp,
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
        const row = await documentRow(client, actor, scope);
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
        return { body: stored.body, byteSize: stored.metadata.byteSize };
      });
    },
  };
}
