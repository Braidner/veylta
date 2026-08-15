import { createHash, randomUUID } from "node:crypto";
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CONTRACT_VERSION,
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  DOCUMENT_INTELLIGENCE_RESULT_STATUSES,
  DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES,
  type DocumentIntelligenceResult,
  type DocumentIntelligenceStructuredResult,
  type DocumentProcessingEventCode,
  LAB_EXTRACTION_SCHEMA_VERSION,
  MAX_DOCUMENT_INTELLIGENCE_STRUCTURED_RESULTS,
  type ProcessingRejectionReason,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import { enrichFactFromAnalyteMappings } from "./analyte-mapping.js";
import { CODEX_DOCUMENT_INTELLIGENCE_VERSION } from "./codex-document-intelligence-provider.js";
import type {
  DocumentIntelligenceExchange,
  DocumentIntelligenceOutput,
} from "./document-intelligence-provider.js";
import {
  type ParsedDocumentPage,
  type ParsedLabExtraction,
  reviewStatusForFact,
  type StrictLabExtractionFact,
  SYNTHETIC_LAB_PARSER_VERSION,
} from "./synthetic-lab-parser.js";

export const DOCUMENT_EXTRACTION_JOB_KIND = "document_extraction" as const;
export const DOCUMENT_EXTRACTION_PAYLOAD_VERSION = "document-extraction-job/v1" as const;
export const DOCUMENT_EXTRACTION_KIND = "deterministic_pdf_text" as const;
export const CODEX_DOCUMENT_EXTRACTION_KIND = "codex_document_intelligence" as const;

export type ProcessingExtractionOutput = (ParsedLabExtraction | DocumentIntelligenceOutput) & {
  /** Present only for a real Codex run; deterministic fixtures have no round trip. */
  exchange?: DocumentIntelligenceExchange;
};

export type ProcessingJobState = "pending" | "leased" | "retry_wait" | "succeeded" | "dead_letter";
export type ProcessingStage =
  | "security_check"
  | "text_extraction"
  | "document_classification"
  | "structured_extraction"
  | "validation";

export type ProcessingErrorCode =
  | "ATTEMPT_LIMIT"
  | "AGENT_OUTPUT_INVALID"
  | "AGENT_UNAVAILABLE"
  | "DOCUMENT_UNAVAILABLE"
  | "EXTRACTION_FAILED"
  | "INVALID_DOCUMENT"
  | "VALIDATION_FAILED";

export interface ProcessingJob {
  id: string;
  familyId: string;
  documentVersionId: string;
  kind: typeof DOCUMENT_EXTRACTION_JOB_KIND;
  dedupeKey: string;
  payloadVersion: typeof DOCUMENT_EXTRACTION_PAYLOAD_VERSION;
  state: ProcessingJobState;
  currentStage: ProcessingStage | null;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastErrorCode: ProcessingErrorCode | null;
  lastErrorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeasedProcessingJob extends ProcessingJob {
  state: "leased";
  leaseOwner: string;
  leaseExpiresAt: string;
}

export interface ProcessingCompletion {
  status: "already_completed" | "completed";
  extractionRunId: string;
  factCount: number;
  needsReviewCount: number;
}

export interface ProcessingJobService {
  enqueueDocumentExtraction(input: {
    familyId: string;
    documentVersionId: string;
    now: Date;
    maxAttempts?: number;
  }): Promise<ProcessingJob>;
  claimNext(input: {
    workerId: string;
    now: Date;
    leaseDurationMs: number;
  }): Promise<LeasedProcessingJob | null>;
  advanceStage(
    claim: LeasedProcessingJob,
    stage: ProcessingStage,
    now: Date,
  ): Promise<LeasedProcessingJob>;
  completeExtraction(
    claim: LeasedProcessingJob,
    output: ProcessingExtractionOutput,
    now: Date,
  ): Promise<ProcessingCompletion>;
  recordFailure(
    claim: LeasedProcessingJob,
    input: {
      now: Date;
      errorCode: ProcessingErrorCode;
      retryDelayMs: number;
      rejectionReason?: ProcessingRejectionReason;
      exchange?: DocumentIntelligenceExchange;
    },
  ): Promise<ProcessingJob>;
  getJob(scope: { familyId: string; jobId: string }): Promise<ProcessingJob | null>;
}

export interface TransactionalProcessingDatabase extends DatabaseClient {
  transaction<T>(operation: (client: DatabaseClient) => Promise<T>): Promise<T>;
}

export interface EnqueueDocumentExtractionInput {
  familyId: string;
  documentVersionId: string;
  now: Date;
  maxAttempts?: number;
}

export interface EnqueueDocumentReanalysisInput extends EnqueueDocumentExtractionInput {
  requestId: string;
}

interface ProcessingJobRow {
  id: string;
  family_id: string;
  document_version_id: string;
  kind: string;
  dedupe_key: string;
  payload_version: string;
  state: string;
  current_stage: string | null;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ExtractionRunRow {
  id: string;
  status: string;
  extractor_version: string;
  output_schema_version: string;
}

interface DocumentPageRow {
  id: string;
  page_number: number;
  extracted_text: string;
  extraction_method: string;
  extraction_version: string;
  text_sha256: string;
}

interface ExtractedFactRow {
  id: string;
  document_version_id: string;
  document_page_id: string;
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
}

interface AuditSourceRow {
  document_id: string;
  uploaded_by_user_id: string;
}

interface DocumentIntelligenceRow {
  id: string;
  document_id: string;
  provider: string;
  model_id: string;
  runtime_version: string;
  schema_version: string;
  category: string;
  title: string;
  short_summary: string;
  detailed_summary: string;
  structured_results_json: string;
  search_text: string;
  document_date: string | null;
  confidence: number;
}

const jobStates = new Set<ProcessingJobState>([
  "pending",
  "leased",
  "retry_wait",
  "succeeded",
  "dead_letter",
]);
const processingStages = new Set<ProcessingStage>([
  "security_check",
  "text_extraction",
  "document_classification",
  "structured_extraction",
  "validation",
]);
const processingStageOrder: readonly ProcessingStage[] = [
  "security_check",
  "text_extraction",
  "document_classification",
  "structured_extraction",
  "validation",
];
const errorMessages: Record<ProcessingErrorCode, string> = {
  ATTEMPT_LIMIT: "Processing attempt limit reached",
  AGENT_OUTPUT_INVALID: "Document intelligence output validation failed",
  AGENT_UNAVAILABLE: "Document intelligence provider is unavailable",
  DOCUMENT_UNAVAILABLE: "Document content is unavailable",
  EXTRACTION_FAILED: "Document text extraction failed",
  INVALID_DOCUMENT: "Document content is invalid",
  VALIDATION_FAILED: "Extraction output validation failed",
};
const versionPattern = /^[a-z0-9][a-z0-9._/+:-]{0,99}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const maxRetryDelayMs = 24 * 60 * 60 * 1_000;
export const MAX_DOCUMENT_INTELLIGENCE_SEARCH_TEXT_LENGTH = 32_000;

export class StaleProcessingLeaseError extends Error {
  constructor() {
    super("Processing lease is stale");
    this.name = "StaleProcessingLeaseError";
  }
}

export class InvalidProcessingOutputError extends Error {
  constructor() {
    super("Processing output is invalid");
    this.name = "InvalidProcessingOutputError";
  }
}

export class InvalidProcessingStageTransitionError extends Error {
  constructor() {
    super("Processing stage transition is invalid");
    this.name = "InvalidProcessingStageTransitionError";
  }
}

export class ProcessingPersistenceConflictError extends Error {
  constructor() {
    super("Existing processing output conflicts with this attempt");
    this.name = "ProcessingPersistenceConflictError";
  }
}

function invalidOutput(): never {
  throw new InvalidProcessingOutputError();
}

function assertIdentifier(value: string, label: string): void {
  if (value.length === 0 || value.length > 200 || value !== value.trim()) {
    throw new Error(`${label} is invalid`);
  }
}

function assertDate(value: Date, label: string): void {
  if (!Number.isFinite(value.getTime())) throw new Error(`${label} is invalid`);
}

function positiveInteger(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} is invalid`);
  }
}

function rowInteger(value: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("Stored processing counter is invalid");
  return parsed;
}

function asJob(row: ProcessingJobRow): ProcessingJob {
  if (
    row.kind !== DOCUMENT_EXTRACTION_JOB_KIND ||
    row.payload_version !== DOCUMENT_EXTRACTION_PAYLOAD_VERSION ||
    !jobStates.has(row.state as ProcessingJobState)
  ) {
    throw new Error("Stored processing job is invalid");
  }
  return {
    id: row.id,
    familyId: row.family_id,
    documentVersionId: row.document_version_id,
    kind: DOCUMENT_EXTRACTION_JOB_KIND,
    dedupeKey: row.dedupe_key,
    payloadVersion: DOCUMENT_EXTRACTION_PAYLOAD_VERSION,
    state: row.state as ProcessingJobState,
    currentStage:
      row.current_stage === null
        ? null
        : processingStages.has(row.current_stage as ProcessingStage)
          ? (row.current_stage as ProcessingStage)
          : (() => {
              throw new Error("Stored processing stage is invalid");
            })(),
    attemptCount: rowInteger(row.attempt_count),
    maxAttempts: rowInteger(row.max_attempts),
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    lastErrorCode: row.last_error_code as ProcessingErrorCode | null,
    lastErrorMessage: row.last_error_message,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asClaim(row: ProcessingJobRow): LeasedProcessingJob {
  const job = asJob(row);
  if (job.state !== "leased" || job.leaseOwner === null || job.leaseExpiresAt === null) {
    throw new Error("Claimed processing job is invalid");
  }
  return {
    ...job,
    state: "leased",
    leaseOwner: job.leaseOwner,
    leaseExpiresAt: job.leaseExpiresAt,
  };
}

/**
 * Records one Codex round trip against its attempt. A replayed attempt keeps the first
 * record: the row is immutable and unique per (job, attempt).
 */
export async function appendProcessingExchangeInTransaction(
  client: DatabaseClient,
  input: {
    familyId: string;
    documentVersionId: string;
    jobId: string;
    attempt: number;
    stage: ProcessingStage;
    outcome: "accepted" | "rejected" | "unavailable";
    rejectionReason: ProcessingRejectionReason | null;
    exchange: DocumentIntelligenceExchange;
  },
): Promise<void> {
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 100) return;
  await client.query(
    `INSERT OR IGNORE INTO processing_job_exchanges
       (id, family_id, document_version_id, processing_job_id, attempt, stage, model_id,
        runtime_version, page_count, request_bytes, response_bytes, request_text,
        response_text, outcome, rejection_reason, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      randomUUID(),
      input.familyId,
      input.documentVersionId,
      input.jobId,
      input.attempt,
      input.stage,
      input.exchange.modelId,
      input.exchange.runtimeVersion,
      Math.min(1000, Math.max(0, input.exchange.pageCount)),
      input.exchange.requestBytes,
      input.exchange.responseBytes,
      input.exchange.requestText,
      input.exchange.responseText,
      input.outcome,
      input.rejectionReason,
      Math.min(86_400_000, Math.max(0, input.exchange.durationMs)),
    ],
  );
}

export async function appendProcessingEventInTransaction(
  client: DatabaseClient,
  input: {
    familyId: string;
    documentVersionId: string;
    jobId: string;
    code: DocumentProcessingEventCode;
    attempt: number;
    occurredAt: Date;
  },
): Promise<void> {
  assertIdentifier(input.familyId, "familyId");
  assertIdentifier(input.documentVersionId, "documentVersionId");
  assertIdentifier(input.jobId, "jobId");
  assertDate(input.occurredAt, "occurredAt");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 0 || input.attempt > 100) {
    throw new Error("attempt is invalid");
  }
  const inserted = await client.query(
    `INSERT INTO processing_job_events
       (id, family_id, document_version_id, processing_job_id, sequence, code, attempt, occurred_at)
     SELECT $1, $2, $3, $4, COALESCE(MAX(sequence), 0) + 1, $5, $6, $7
       FROM processing_job_events
      WHERE family_id = $2 AND processing_job_id = $4`,
    [
      randomUUID(),
      input.familyId,
      input.documentVersionId,
      input.jobId,
      input.code,
      input.attempt,
      input.occurredAt.toISOString(),
    ],
  );
  if (inserted.rowCount !== 1) throw new ProcessingPersistenceConflictError();
}

function dedupeKey(familyId: string, documentVersionId: string): string {
  return `extract:${familyId}:${documentVersionId}:${CODEX_DOCUMENT_INTELLIGENCE_VERSION}`;
}

export async function enqueueDocumentExtractionInTransaction(
  client: DatabaseClient,
  input: EnqueueDocumentExtractionInput,
): Promise<ProcessingJob> {
  assertIdentifier(input.familyId, "familyId");
  assertIdentifier(input.documentVersionId, "documentVersionId");
  assertDate(input.now, "now");
  const maxAttempts = input.maxAttempts ?? 3;
  positiveInteger(maxAttempts, 100, "maxAttempts");
  return enqueueWithDedupeKey(client, input, dedupeKey(input.familyId, input.documentVersionId));
}

async function enqueueWithDedupeKey(
  client: DatabaseClient,
  input: EnqueueDocumentExtractionInput,
  key: string,
): Promise<ProcessingJob> {
  const maxAttempts = input.maxAttempts ?? 3;
  const now = input.now.toISOString();
  const jobId = randomUUID();
  const inserted = await client.query(
    `INSERT INTO processing_jobs
       (id, family_id, document_version_id, kind, dedupe_key, payload_version,
        state, attempt_count, max_attempts, available_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, $7, $8, $8, $8)
     ON CONFLICT (kind, dedupe_key) DO NOTHING`,
    [
      jobId,
      input.familyId,
      input.documentVersionId,
      DOCUMENT_EXTRACTION_JOB_KIND,
      key,
      DOCUMENT_EXTRACTION_PAYLOAD_VERSION,
      maxAttempts,
      now,
    ],
  );
  const row = (
    await client.query<ProcessingJobRow>(
      "SELECT * FROM processing_jobs WHERE kind = $1 AND dedupe_key = $2",
      [DOCUMENT_EXTRACTION_JOB_KIND, key],
    )
  ).rows[0];
  if (
    row === undefined ||
    row.family_id !== input.familyId ||
    row.document_version_id !== input.documentVersionId
  ) {
    throw new ProcessingPersistenceConflictError();
  }
  if (inserted.rowCount === 1) {
    await appendProcessingEventInTransaction(client, {
      familyId: input.familyId,
      documentVersionId: input.documentVersionId,
      jobId,
      code: "queued",
      attempt: 0,
      occurredAt: input.now,
    });
  }
  return asJob(row);
}

export async function enqueueDocumentReanalysisInTransaction(
  client: DatabaseClient,
  input: EnqueueDocumentReanalysisInput,
): Promise<ProcessingJob> {
  assertIdentifier(input.familyId, "familyId");
  assertIdentifier(input.documentVersionId, "documentVersionId");
  assertIdentifier(input.requestId, "requestId");
  assertDate(input.now, "now");
  const maxAttempts = input.maxAttempts ?? 3;
  positiveInteger(maxAttempts, 100, "maxAttempts");
  const key = `${dedupeKey(input.familyId, input.documentVersionId)}:restart:${input.requestId}`;
  return enqueueWithDedupeKey(client, input, key);
}

function stableId(kind: string, ...parts: readonly (number | string)[]): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([kind, ...parts]))
    .digest("hex")
    .slice(0, 40);
  return `${kind}_${digest}`;
}

function boundedText(
  value: unknown,
  maximum: number,
  nullable: boolean,
): asserts value is string | null {
  if (value === null) {
    if (!nullable) invalidOutput();
    return;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value !== value.trim() ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  ) {
    invalidOutput();
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isCanonicalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function exactObjectKeys(value: object, expected: readonly string[]): void {
  if (Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) invalidOutput();
}

function isRussianText(value: string): boolean {
  return /[А-Яа-яЁё]/u.test(value);
}

function exactSourceFragment(
  source: DocumentIntelligenceStructuredResult["source"],
  pages: ReadonlyMap<number, ParsedDocumentPage>,
): void {
  if (
    typeof source !== "object" ||
    source === null ||
    Array.isArray(source) ||
    !Number.isSafeInteger(source.pageNumber)
  ) {
    invalidOutput();
  }
  exactObjectKeys(source, ["pageNumber", "fragment"]);
  const pageText = pages.get(source.pageNumber)?.text.replaceAll("\r\n", "\n");
  const fragment =
    typeof source.fragment === "string" ? source.fragment.replaceAll("\r\n", "\n") : "";
  if (
    pageText === undefined ||
    fragment.length < 12 ||
    fragment.length > 2_000 ||
    fragment !== fragment.trim() ||
    !`\n${pageText}\n`.includes(`\n${fragment}\n`)
  ) {
    invalidOutput();
  }
}

function structuredResult(
  value: unknown,
  pages: ReadonlyMap<number, ParsedDocumentPage>,
): DocumentIntelligenceStructuredResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidOutput();
  exactObjectKeys(value, [
    "resultKey",
    "type",
    "label",
    "value",
    "unit",
    "code",
    "lab",
    "specimen",
    "date",
    "status",
    "confidence",
    "source",
  ]);
  const result = value as Record<string, unknown>;
  const resultKey = result.resultKey;
  boundedText(resultKey, 100, false);
  if (resultKey === null || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resultKey)) invalidOutput();
  if (
    typeof result.type !== "string" ||
    !DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES.includes(
      result.type as DocumentIntelligenceStructuredResult["type"],
    )
  ) {
    invalidOutput();
  }
  const label = result.label;
  boundedText(label, 200, false);
  if (label === null || !isRussianText(label)) invalidOutput();
  boundedText(result.value, 500, true);
  boundedText(result.unit, 100, true);
  boundedText(result.code, 100, true);
  boundedText(result.lab, 200, true);
  boundedText(result.specimen, 200, true);
  boundedText(result.date, 10, true);
  if (result.unit !== null && result.value === null) invalidOutput();
  if (result.date !== null && !isCanonicalDate(result.date)) invalidOutput();
  if (
    typeof result.status !== "string" ||
    !DOCUMENT_INTELLIGENCE_RESULT_STATUSES.includes(
      result.status as DocumentIntelligenceStructuredResult["status"],
    )
  ) {
    invalidOutput();
  }
  if (
    typeof result.confidence !== "number" ||
    !Number.isFinite(result.confidence) ||
    result.confidence < 0 ||
    result.confidence > 1
  ) {
    invalidOutput();
  }
  const source = result.source as DocumentIntelligenceStructuredResult["source"];
  exactSourceFragment(source, pages);
  return {
    resultKey,
    type: result.type as DocumentIntelligenceStructuredResult["type"],
    label,
    value: result.value as string | null,
    unit: result.unit as string | null,
    code: result.code as string | null,
    lab: result.lab as string | null,
    specimen: result.specimen as string | null,
    date: result.date as string | null,
    status: result.status as DocumentIntelligenceStructuredResult["status"],
    confidence: result.confidence,
    source: { pageNumber: source.pageNumber, fragment: source.fragment },
  };
}

function completeDocumentIntelligence(
  value: DocumentIntelligenceResult,
  pages: ReadonlyMap<number, ParsedDocumentPage>,
): DocumentIntelligenceResult {
  boundedText(value.modelId, 100, false);
  boundedText(value.runtimeVersion, 100, false);
  boundedText(value.title, 200, false);
  boundedText(value.shortSummary, 500, false);
  if (
    value.contractVersion !== DOCUMENT_INTELLIGENCE_CONTRACT_VERSION ||
    value.provider !== "codex" ||
    !DOCUMENT_CATEGORIES.includes(value.category) ||
    !isRussianText(value.title) ||
    !isRussianText(value.shortSummary) ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    (value.documentDate !== null && !isCanonicalDate(value.documentDate))
  ) {
    invalidOutput();
  }

  boundedText(value.detailedSummary, 4_000, false);
  if (!isRussianText(value.detailedSummary)) {
    invalidOutput();
  }
  if (
    !Array.isArray(value.structuredResults) ||
    value.structuredResults.length > MAX_DOCUMENT_INTELLIGENCE_STRUCTURED_RESULTS
  ) {
    invalidOutput();
  }
  const seen = new Set<string>();
  const structuredResults = value.structuredResults.map((item) => {
    const result = structuredResult(item, pages);
    if (seen.has(result.resultKey)) invalidOutput();
    seen.add(result.resultKey);
    return result;
  });
  return {
    ...value,
    structuredResults,
  };
}

export function normalizeDocumentIntelligenceSearchText(value: DocumentIntelligenceResult): string {
  const resultFields = value.structuredResults.flatMap((result) => [
    result.label,
    result.value,
    result.unit,
    result.code,
    result.lab,
    result.specimen,
    result.date,
    result.status,
  ]);
  const normalized = [value.title, value.shortSummary, value.detailedSummary, ...resultFields]
    .filter((part): part is string => part !== null)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized.length <= MAX_DOCUMENT_INTELLIGENCE_SEARCH_TEXT_LENGTH) return normalized;
  const candidate = normalized.slice(0, MAX_DOCUMENT_INTELLIGENCE_SEARCH_TEXT_LENGTH + 1);
  const wordBoundary = candidate.lastIndexOf(" ");
  return candidate.slice(
    0,
    wordBoundary > 0 ? wordBoundary : MAX_DOCUMENT_INTELLIGENCE_SEARCH_TEXT_LENGTH,
  );
}

function assertPage(page: ParsedDocumentPage, seen: Set<number>): void {
  if (
    !Number.isSafeInteger(page.pageNumber) ||
    page.pageNumber < 1 ||
    page.pageNumber > 1_000 ||
    seen.has(page.pageNumber) ||
    page.text.length > 250_000 ||
    !versionPattern.test(page.extractionMethod) ||
    !versionPattern.test(page.extractionVersion) ||
    !sha256Pattern.test(page.textSha256) ||
    createHash("sha256").update(page.text, "utf8").digest("hex") !== page.textSha256
  ) {
    invalidOutput();
  }
  seen.add(page.pageNumber);
}

function assertFact(
  fact: StrictLabExtractionFact,
  pages: ReadonlyMap<number, ParsedDocumentPage>,
  seen: Set<string>,
): void {
  boundedText(fact.factKey, 100, false);
  boundedText(fact.sourceName, 200, false);
  boundedText(fact.sourceValue, 100, false);
  boundedText(fact.sourceUnit, 100, false);
  boundedText(fact.proposedCanonicalCode, 100, true);
  boundedText(fact.proposedNormalizedValue, 100, true);
  boundedText(fact.proposedNormalizedUnit, 100, true);
  boundedText(fact.proposedSpecimenType, 200, true);
  boundedText(fact.proposedLaboratory, 200, true);
  if (
    seen.has(fact.factKey) ||
    !Number.isFinite(fact.confidence) ||
    fact.confidence < 0 ||
    fact.confidence > 1 ||
    (fact.proposedNormalizedValue === null) !== (fact.proposedNormalizedUnit === null) ||
    new Set(fact.validationIssues).size !== fact.validationIssues.length ||
    fact.validationIssues.some(
      (issue) =>
        issue !== "LOW_CONFIDENCE" &&
        issue !== "AMBIGUOUS_UNIT" &&
        issue !== "MISSING_UNIT" &&
        issue !== "INVALID_VALUE" &&
        issue !== "INVALID_DATE" &&
        issue !== "INVALID_REFERENCE_RANGE" &&
        issue !== "UNSUPPORTED_ANALYTE",
    )
  ) {
    invalidOutput();
  }
  const page = pages.get(fact.source.pageNumber);
  const pageText = page?.text.replaceAll("\r\n", "\n");
  if (
    page === undefined ||
    pageText === undefined ||
    fact.source.fragment.length === 0 ||
    fact.source.fragment.length > 2_000 ||
    !`\n${pageText}\n`.includes(`\n${fact.source.fragment}\n`)
  ) {
    invalidOutput();
  }
  if (fact.referenceRange !== null) {
    boundedText(fact.referenceRange.sourceText, 200, true);
    boundedText(fact.referenceRange.sourceLow, 100, true);
    boundedText(fact.referenceRange.sourceHigh, 100, true);
    boundedText(fact.referenceRange.sourceUnit, 100, true);
  }
  for (const timestamp of [fact.proposedSampledAt, fact.proposedResultedAt]) {
    if (timestamp !== null && !isCanonicalTimestamp(timestamp)) invalidOutput();
  }
  if (
    fact.proposedSampledAt !== null &&
    fact.proposedResultedAt !== null &&
    fact.proposedResultedAt < fact.proposedSampledAt
  ) {
    invalidOutput();
  }
  seen.add(fact.factKey);
}

function validateOutput(output: ProcessingExtractionOutput): DocumentIntelligenceResult | null {
  const isCodexOutput = "intelligence" in output;
  if (
    output.extraction.schemaVersion !== LAB_EXTRACTION_SCHEMA_VERSION ||
    (output.extraction.extractorVersion !== SYNTHETIC_LAB_PARSER_VERSION &&
      output.extraction.extractorVersion !== CODEX_DOCUMENT_INTELLIGENCE_VERSION) ||
    output.pages.length === 0 ||
    output.pages.length > 50 ||
    (!isCodexOutput && output.extraction.items.length === 0) ||
    output.extraction.items.length > 100
  ) {
    invalidOutput();
  }
  const pages = new Map<number, ParsedDocumentPage>();
  for (const page of output.pages) {
    assertPage(page, new Set(pages.keys()));
    pages.set(page.pageNumber, page);
  }
  const facts = new Set<string>();
  for (const fact of output.extraction.items) assertFact(fact, pages, facts);
  return isCodexOutput ? completeDocumentIntelligence(output.intelligence, pages) : null;
}

async function jobRow(
  client: DatabaseClient,
  scope: { familyId: string; jobId: string },
): Promise<ProcessingJobRow | undefined> {
  return (
    await client.query<ProcessingJobRow>(
      "SELECT * FROM processing_jobs WHERE family_id = $1 AND id = $2",
      [scope.familyId, scope.jobId],
    )
  ).rows[0];
}

function pageId(job: LeasedProcessingJob, page: ParsedDocumentPage): string {
  return stableId("page", job.familyId, job.documentVersionId, page.pageNumber);
}

function runId(
  job: LeasedProcessingJob,
  extractorVersion: string = SYNTHETIC_LAB_PARSER_VERSION,
): string {
  return stableId("run", job.familyId, job.documentVersionId, job.id, extractorVersion);
}

function factId(
  job: LeasedProcessingJob,
  fact: StrictLabExtractionFact,
  extractorVersion: string = SYNTHETIC_LAB_PARSER_VERSION,
): string {
  return stableId("fact", runId(job, extractorVersion), fact.factKey);
}

type AutomatedProcessingOutcome =
  | { action: "document.processing.completed"; outcome: "completed" }
  | {
      action: "document.processing.retry_scheduled";
      outcome: "retry_wait";
      errorCode: ProcessingErrorCode;
    }
  | {
      action: "document.processing.failed";
      outcome: "dead_letter";
      errorCode: ProcessingErrorCode;
    };

async function auditAutomatedProcessingOutcome(
  client: DatabaseClient,
  job: LeasedProcessingJob,
  event: AutomatedProcessingOutcome,
  createdAt: string,
): Promise<void> {
  const source = (
    await client.query<AuditSourceRow>(
      `SELECT d.id AS document_id, d.uploaded_by_user_id
         FROM document_versions v
         JOIN documents d
           ON d.id = v.document_id
          AND d.family_id = v.family_id
        WHERE v.family_id = $1 AND v.id = $2`,
      [job.familyId, job.documentVersionId],
    )
  ).rows[0];
  if (source === undefined) throw new ProcessingPersistenceConflictError();

  const metadata: {
    contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
    automated: true;
    errorCode?: ProcessingErrorCode;
    outcome: AutomatedProcessingOutcome["outcome"];
  } = {
    contractVersion: DOCUMENT_CONTRACT_VERSION,
    automated: true,
    outcome: event.outcome,
  };
  if ("errorCode" in event) metadata.errorCode = event.errorCode;

  await client.query(
    `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, resource_type, resource_id, result,
        correlation_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, 'Document', $5, 'success', $6, $7, $8)`,
    [
      randomUUID(),
      job.familyId,
      source.uploaded_by_user_id,
      event.action,
      source.document_id,
      `worker:${job.id}`,
      metadata,
      createdAt,
    ],
  );
}

async function insertOrVerifyPage(
  client: DatabaseClient,
  job: LeasedProcessingJob,
  page: ParsedDocumentPage,
  createdAt: string,
): Promise<void> {
  const id = pageId(job, page);
  await client.query(
    `INSERT INTO document_pages
       (id, family_id, document_version_id, page_number, extracted_text,
        extraction_method, extraction_version, text_sha256, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (family_id, document_version_id, page_number) DO NOTHING`,
    [
      id,
      job.familyId,
      job.documentVersionId,
      page.pageNumber,
      page.text,
      page.extractionMethod,
      page.extractionVersion,
      page.textSha256,
      createdAt,
    ],
  );
  const row = (
    await client.query<DocumentPageRow>(
      `SELECT id, page_number, extracted_text, extraction_method, extraction_version, text_sha256
         FROM document_pages
        WHERE family_id = $1 AND document_version_id = $2 AND page_number = $3`,
      [job.familyId, job.documentVersionId, page.pageNumber],
    )
  ).rows[0];
  if (
    row === undefined ||
    row.id !== id ||
    Number(row.page_number) !== page.pageNumber ||
    row.extracted_text !== page.text ||
    row.extraction_method !== page.extractionMethod ||
    row.extraction_version !== page.extractionVersion ||
    row.text_sha256 !== page.textSha256
  ) {
    throw new ProcessingPersistenceConflictError();
  }
}

function storedFactValues(fact: StrictLabExtractionFact): readonly unknown[] {
  return [
    fact.source.fragment,
    fact.sourceName,
    fact.sourceValue,
    fact.sourceUnit,
    fact.proposedCanonicalCode,
    fact.proposedNormalizedValue,
    fact.proposedNormalizedUnit,
    fact.referenceRange === null ? null : JSON.stringify(fact.referenceRange),
    fact.proposedSpecimenType,
    fact.proposedSampledAt,
    fact.proposedResultedAt,
    fact.proposedLaboratory,
    fact.confidence,
    JSON.stringify(fact.validationIssues),
    reviewStatusForFact(fact),
  ];
}

async function insertOrVerifyFact(
  client: DatabaseClient,
  job: LeasedProcessingJob,
  fact: StrictLabExtractionFact,
  pages: ReadonlyMap<number, ParsedDocumentPage>,
  createdAt: string,
  extractorVersion: string = SYNTHETIC_LAB_PARSER_VERSION,
): Promise<void> {
  const id = factId(job, fact, extractorVersion);
  const page = pages.get(fact.source.pageNumber);
  if (page === undefined) throw new InvalidProcessingOutputError();
  const documentPageId = pageId(job, page);
  const values = storedFactValues(fact);
  await client.query(
    `INSERT INTO extracted_facts
       (id, family_id, document_version_id, extraction_run_id, document_page_id, fact_key,
        source_fragment, source_name, source_value, source_unit,
        proposed_canonical_code, proposed_normalized_value, proposed_normalized_unit,
        proposed_reference_range, proposed_specimen, proposed_sampled_at,
        proposed_resulted_at, proposed_laboratory, confidence, validation_issues,
        review_status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22)
     ON CONFLICT (family_id, extraction_run_id, fact_key) DO NOTHING`,
    [
      id,
      job.familyId,
      job.documentVersionId,
      runId(job, extractorVersion),
      documentPageId,
      fact.factKey,
      ...values,
      createdAt,
    ],
  );
  const row = (
    await client.query<ExtractedFactRow>(
      `SELECT id, document_version_id, document_page_id, fact_key, source_fragment, source_name, source_value,
              source_unit, proposed_canonical_code, proposed_normalized_value,
              proposed_normalized_unit, proposed_reference_range, proposed_specimen,
              proposed_sampled_at, proposed_resulted_at, proposed_laboratory,
              confidence, validation_issues, review_status
         FROM extracted_facts
        WHERE family_id = $1 AND extraction_run_id = $2 AND fact_key = $3`,
      [job.familyId, runId(job, extractorVersion), fact.factKey],
    )
  ).rows[0];
  if (
    row === undefined ||
    row.id !== id ||
    row.document_version_id !== job.documentVersionId ||
    row.document_page_id !== documentPageId ||
    row.fact_key !== fact.factKey ||
    JSON.stringify([
      row.source_fragment,
      row.source_name,
      row.source_value,
      row.source_unit,
      row.proposed_canonical_code,
      row.proposed_normalized_value,
      row.proposed_normalized_unit,
      row.proposed_reference_range,
      row.proposed_specimen,
      row.proposed_sampled_at,
      row.proposed_resulted_at,
      row.proposed_laboratory,
      Number(row.confidence),
      row.validation_issues,
      row.review_status,
    ]) !== JSON.stringify(values)
  ) {
    throw new ProcessingPersistenceConflictError();
  }
}

async function completionFromStored(
  client: DatabaseClient,
  job: LeasedProcessingJob,
  expectedFactCount: number,
  status: ProcessingCompletion["status"],
  extractorVersion: string = SYNTHETIC_LAB_PARSER_VERSION,
): Promise<ProcessingCompletion> {
  const expectedRunId = runId(job, extractorVersion);
  const run = (
    await client.query<ExtractionRunRow>(
      `SELECT id, status, extractor_version, output_schema_version
         FROM extraction_runs WHERE family_id = $1 AND job_id = $2`,
      [job.familyId, job.id],
    )
  ).rows[0];
  const counts = await client.query<{ fact_count: number; needs_review_count: number }>(
    `SELECT count(*) AS fact_count,
            sum(CASE WHEN review_status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review_count
       FROM extracted_facts
      WHERE family_id = $1 AND extraction_run_id = $2`,
    [job.familyId, expectedRunId],
  );
  const factCount = Number(counts.rows[0]?.fact_count ?? 0);
  const needsReviewCount = Number(counts.rows[0]?.needs_review_count ?? 0);
  if (
    run === undefined ||
    run.id !== expectedRunId ||
    run.extractor_version !== extractorVersion ||
    run.output_schema_version !== LAB_EXTRACTION_SCHEMA_VERSION ||
    (run.status !== "awaiting_review" && run.status !== "completed") ||
    factCount !== expectedFactCount
  ) {
    throw new ProcessingPersistenceConflictError();
  }
  return { status, extractionRunId: expectedRunId, factCount, needsReviewCount };
}

async function insertOrVerifyIntelligence(
  client: DatabaseClient,
  claim: LeasedProcessingJob,
  documentId: string,
  value: DocumentIntelligenceResult,
  createdAt: string,
): Promise<void> {
  const id = stableId("intelligence", claim.familyId, claim.documentVersionId, claim.id);
  const structuredResultsJson = JSON.stringify(value.structuredResults);
  const searchText = normalizeDocumentIntelligenceSearchText(value);
  await client.query(
    `INSERT INTO document_intelligence_results
       (id, family_id, document_id, document_version_id, processing_job_id,
        provider, model_id, runtime_version, schema_version, category,
        title, short_summary, detailed_summary, structured_results_json, search_text,
        document_date, confidence, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18)
     ON CONFLICT (family_id, processing_job_id) DO NOTHING`,
    [
      id,
      claim.familyId,
      documentId,
      claim.documentVersionId,
      claim.id,
      value.provider,
      value.modelId,
      value.runtimeVersion,
      value.contractVersion,
      value.category,
      value.title,
      value.shortSummary,
      value.detailedSummary,
      structuredResultsJson,
      searchText,
      value.documentDate,
      value.confidence,
      createdAt,
    ],
  );
  const stored = (
    await client.query<DocumentIntelligenceRow>(
      `SELECT id, document_id, provider, model_id, runtime_version, schema_version,
              category, title, short_summary, detailed_summary, structured_results_json,
              search_text, document_date, confidence
         FROM document_intelligence_results
        WHERE family_id = $1 AND processing_job_id = $2`,
      [claim.familyId, claim.id],
    )
  ).rows[0];
  if (
    stored === undefined ||
    stored.id !== id ||
    stored.document_id !== documentId ||
    stored.provider !== "codex" ||
    stored.model_id !== value.modelId ||
    stored.runtime_version !== value.runtimeVersion ||
    stored.schema_version !== DOCUMENT_INTELLIGENCE_CONTRACT_VERSION ||
    stored.category !== value.category ||
    stored.title !== value.title ||
    stored.short_summary !== value.shortSummary ||
    stored.detailed_summary !== value.detailedSummary ||
    stored.structured_results_json !== structuredResultsJson ||
    stored.search_text !== searchText ||
    stored.document_date !== value.documentDate ||
    Number(stored.confidence) !== value.confidence
  ) {
    throw new ProcessingPersistenceConflictError();
  }
}

export function createProcessingJobService(
  database: TransactionalProcessingDatabase,
): ProcessingJobService {
  return {
    async enqueueDocumentExtraction(input) {
      return database.transaction((client) =>
        enqueueDocumentExtractionInTransaction(client, input),
      );
    },

    async claimNext(input) {
      assertIdentifier(input.workerId, "workerId");
      assertDate(input.now, "now");
      positiveInteger(input.leaseDurationMs, maxRetryDelayMs, "leaseDurationMs");
      const now = input.now.toISOString();
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseDurationMs).toISOString();
      const leaseOwner = `${input.workerId}:${randomUUID()}`;
      if (leaseOwner.length > 200) throw new Error("workerId is too long for a lease token");

      return database.transaction(async (client) => {
        const exhaustedLeases = await client.query<ProcessingJobRow>(
          `SELECT * FROM processing_jobs
            WHERE kind = $1 AND payload_version = $2 AND state = 'leased'
              AND lease_expires_at <= $3 AND attempt_count = max_attempts`,
          [DOCUMENT_EXTRACTION_JOB_KIND, DOCUMENT_EXTRACTION_PAYLOAD_VERSION, now],
        );
        for (const exhaustedLease of exhaustedLeases.rows) {
          const updatedExpiredLease = await client.query(
            `UPDATE processing_jobs
                SET state = 'dead_letter', current_stage = NULL,
                    lease_owner = NULL, lease_expires_at = NULL,
                    last_error_code = 'ATTEMPT_LIMIT', last_error_message = $1,
                    completed_at = $2, updated_at = $2
              WHERE id = $3 AND family_id = $4 AND state = 'leased'
                AND lease_owner = $5 AND lease_expires_at = $6
                AND attempt_count = max_attempts`,
            [
              errorMessages.ATTEMPT_LIMIT,
              now,
              exhaustedLease.id,
              exhaustedLease.family_id,
              exhaustedLease.lease_owner,
              exhaustedLease.lease_expires_at,
            ],
          );
          if (updatedExpiredLease.rowCount !== 1) continue;
          await appendProcessingEventInTransaction(client, {
            familyId: exhaustedLease.family_id,
            documentVersionId: exhaustedLease.document_version_id,
            jobId: exhaustedLease.id,
            code: "failed",
            attempt: Number(exhaustedLease.attempt_count),
            occurredAt: input.now,
          });
          await auditAutomatedProcessingOutcome(
            client,
            asClaim(exhaustedLease),
            {
              action: "document.processing.failed",
              outcome: "dead_letter",
              errorCode: "ATTEMPT_LIMIT",
            },
            now,
          );
        }
        const candidate = (
          await client.query<ProcessingJobRow>(
            `SELECT * FROM processing_jobs
              WHERE kind = $1 AND payload_version = $2 AND attempt_count < max_attempts
                AND EXISTS (
                  SELECT 1
                    FROM document_versions v
                    JOIN documents d
                      ON d.family_id = v.family_id
                     AND d.id = v.document_id
                    JOIN patient_profiles p
                      ON p.family_id = d.family_id
                     AND p.id = d.patient_profile_id
                     AND p.archived_at IS NULL
                   WHERE v.family_id = processing_jobs.family_id
                     AND v.id = processing_jobs.document_version_id
                     AND d.deleted_at IS NULL
                )
                AND (
                  (state IN ('pending', 'retry_wait') AND available_at <= $3)
                  OR (state = 'leased' AND lease_expires_at <= $3)
                )
              ORDER BY available_at, created_at, id
              LIMIT 1`,
            [DOCUMENT_EXTRACTION_JOB_KIND, DOCUMENT_EXTRACTION_PAYLOAD_VERSION, now],
          )
        ).rows[0];
        if (candidate === undefined) return null;
        const updated = await client.query(
          `UPDATE processing_jobs
              SET state = 'leased', current_stage = 'security_check',
                  attempt_count = attempt_count + 1,
                  lease_owner = $1, lease_expires_at = $2,
                  last_error_code = NULL, last_error_message = NULL,
                  completed_at = NULL, updated_at = $3
            WHERE id = $4 AND family_id = $5 AND attempt_count = $6
              AND (
                (state IN ('pending', 'retry_wait') AND available_at <= $3)
                OR (state = 'leased' AND lease_expires_at <= $3)
              )`,
          [
            leaseOwner,
            leaseExpiresAt,
            now,
            candidate.id,
            candidate.family_id,
            candidate.attempt_count,
          ],
        );
        if (updated.rowCount !== 1) return null;
        const row = await jobRow(client, { familyId: candidate.family_id, jobId: candidate.id });
        if (row === undefined) throw new Error("Claimed processing job disappeared");
        await appendProcessingEventInTransaction(client, {
          familyId: row.family_id,
          documentVersionId: row.document_version_id,
          jobId: row.id,
          code: "security_check_started",
          attempt: Number(row.attempt_count),
          occurredAt: input.now,
        });
        return asClaim(row);
      });
    },

    async advanceStage(claim, stage, changedAt) {
      if (!processingStages.has(stage)) throw new Error("stage is invalid");
      assertDate(changedAt, "changedAt");
      const now = changedAt.toISOString();
      return database.transaction(async (client) => {
        const stored = await jobRow(client, { familyId: claim.familyId, jobId: claim.id });
        if (
          stored === undefined ||
          stored.state !== "leased" ||
          stored.lease_owner !== claim.leaseOwner ||
          stored.lease_expires_at === null ||
          stored.lease_expires_at <= now ||
          stored.current_stage === null ||
          !processingStages.has(stored.current_stage as ProcessingStage)
        ) {
          throw new StaleProcessingLeaseError();
        }
        const currentStage = stored.current_stage as ProcessingStage;
        if (currentStage === stage) return asClaim(stored);
        const currentIndex = processingStageOrder.indexOf(currentStage);
        if (processingStageOrder[currentIndex + 1] !== stage) {
          throw new InvalidProcessingStageTransitionError();
        }
        const updated = await client.query(
          `UPDATE processing_jobs
              SET current_stage = $1, updated_at = $2
            WHERE id = $3 AND family_id = $4 AND state = 'leased'
              AND lease_owner = $5 AND lease_expires_at > $2 AND current_stage = $6`,
          [stage, now, claim.id, claim.familyId, claim.leaseOwner, currentStage],
        );
        if (updated.rowCount !== 1) throw new StaleProcessingLeaseError();
        const row = await jobRow(client, { familyId: claim.familyId, jobId: claim.id });
        if (row === undefined) throw new Error("Processing job disappeared");
        const eventCode: Record<ProcessingStage, DocumentProcessingEventCode> = {
          security_check: "security_check_started",
          text_extraction: "text_extraction_started",
          document_classification: "document_classification_started",
          structured_extraction: "codex_analysis_started",
          validation: "result_validation_started",
        };
        await appendProcessingEventInTransaction(client, {
          familyId: row.family_id,
          documentVersionId: row.document_version_id,
          jobId: row.id,
          code: eventCode[stage],
          attempt: Number(row.attempt_count),
          occurredAt: changedAt,
        });
        return asClaim(row);
      });
    },

    async completeExtraction(claim, output, completedAt) {
      assertDate(completedAt, "completedAt");
      const intelligence = validateOutput(output);
      const extractorVersion = output.extraction.extractorVersion;
      const isCodexOutput = intelligence !== null;
      const now = completedAt.toISOString();
      const pages = new Map(output.pages.map((page) => [page.pageNumber, page]));
      return database.transaction(async (client) => {
        const stored = await jobRow(client, { familyId: claim.familyId, jobId: claim.id });
        if (stored?.state === "succeeded") {
          return completionFromStored(
            client,
            claim,
            output.extraction.items.length,
            "already_completed",
            extractorVersion,
          );
        }
        if (
          stored === undefined ||
          stored.state !== "leased" ||
          stored.lease_owner !== claim.leaseOwner ||
          stored.lease_expires_at === null ||
          stored.lease_expires_at <= now
        ) {
          throw new StaleProcessingLeaseError();
        }
        if (stored.current_stage !== "validation") {
          throw new InvalidProcessingStageTransitionError();
        }
        const activeProfile = await client.query<{ document_id: string; id: string }>(
          `SELECT p.id, d.id AS document_id
             FROM document_versions v
             JOIN documents d
               ON d.family_id = v.family_id
              AND d.id = v.document_id
             JOIN patient_profiles p
               ON p.family_id = d.family_id
              AND p.id = d.patient_profile_id
              AND p.archived_at IS NULL
            WHERE v.family_id = $1 AND v.id = $2
              AND d.deleted_at IS NULL`,
          [claim.familyId, claim.documentVersionId],
        );
        const source = activeProfile.rows[0];
        if (source === undefined) throw new ProcessingPersistenceConflictError();

        const extractionStatus =
          output.extraction.items.length === 0 ? "completed" : "awaiting_review";
        await client.query(
          `INSERT INTO extraction_runs
               (id, family_id, document_version_id, job_id, extractor_kind,
                extractor_version, output_schema_version, status, started_at,
                completed_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $9)
             ON CONFLICT (family_id, job_id) DO NOTHING`,
          [
            runId(claim, extractorVersion),
            claim.familyId,
            claim.documentVersionId,
            claim.id,
            isCodexOutput ? CODEX_DOCUMENT_EXTRACTION_KIND : DOCUMENT_EXTRACTION_KIND,
            extractorVersion,
            LAB_EXTRACTION_SCHEMA_VERSION,
            extractionStatus,
            claim.updatedAt,
            now,
          ],
        );
        for (const page of output.pages) await insertOrVerifyPage(client, claim, page, now);
        for (const fact of output.extraction.items) {
          await insertOrVerifyFact(
            client,
            claim,
            await enrichFactFromAnalyteMappings(client, fact),
            pages,
            now,
            extractorVersion,
          );
        }
        if (isCodexOutput) {
          await insertOrVerifyIntelligence(client, claim, source.document_id, intelligence, now);
        }
        const updated = await client.query(
          `UPDATE processing_jobs
                SET state = 'succeeded', current_stage = NULL,
                    lease_owner = NULL, lease_expires_at = NULL,
                    last_error_code = NULL, last_error_message = NULL,
                    completed_at = $1, updated_at = $1
              WHERE id = $2 AND family_id = $3 AND state = 'leased'
                AND lease_owner = $4 AND lease_expires_at > $1
                AND current_stage = 'validation'`,
          [now, claim.id, claim.familyId, claim.leaseOwner],
        );
        if (updated.rowCount !== 1) throw new StaleProcessingLeaseError();
        if (output.exchange !== undefined) {
          await appendProcessingExchangeInTransaction(client, {
            familyId: stored.family_id,
            documentVersionId: stored.document_version_id,
            jobId: stored.id,
            attempt: Number(stored.attempt_count),
            stage: "validation",
            outcome: "accepted",
            rejectionReason: null,
            exchange: output.exchange,
          });
        }
        await appendProcessingEventInTransaction(client, {
          familyId: stored.family_id,
          documentVersionId: stored.document_version_id,
          jobId: stored.id,
          code: "result_saved",
          attempt: Number(stored.attempt_count),
          occurredAt: completedAt,
        });
        await auditAutomatedProcessingOutcome(
          client,
          claim,
          {
            action: "document.processing.completed",
            outcome: "completed",
          },
          now,
        );
        return completionFromStored(
          client,
          claim,
          output.extraction.items.length,
          "completed",
          extractorVersion,
        );
      });
    },

    async recordFailure(claim, input) {
      assertDate(input.now, "now");
      positiveInteger(input.retryDelayMs, maxRetryDelayMs, "retryDelayMs");
      if (!(input.errorCode in errorMessages)) throw new Error("errorCode is invalid");
      const now = input.now.toISOString();
      return database.transaction(async (client) => {
        const stored = await jobRow(client, { familyId: claim.familyId, jobId: claim.id });
        if (
          stored === undefined ||
          stored.state !== "leased" ||
          stored.lease_owner !== claim.leaseOwner ||
          stored.lease_expires_at === null ||
          stored.lease_expires_at <= now
        ) {
          throw new StaleProcessingLeaseError();
        }
        const exhausted = Number(stored.attempt_count) >= Number(stored.max_attempts);
        const availableAt = new Date(input.now.getTime() + input.retryDelayMs).toISOString();
        const updated = await client.query(
          `UPDATE processing_jobs
              SET state = $1, current_stage = NULL,
                  lease_owner = NULL, lease_expires_at = NULL,
                  last_error_code = $2, last_error_message = $3,
                  available_at = $4, completed_at = $5, updated_at = $6
            WHERE id = $7 AND family_id = $8 AND state = 'leased'
              AND lease_owner = $9 AND lease_expires_at > $6`,
          [
            exhausted ? "dead_letter" : "retry_wait",
            input.errorCode,
            errorMessages[input.errorCode],
            availableAt,
            exhausted ? now : null,
            now,
            claim.id,
            claim.familyId,
            claim.leaseOwner,
          ],
        );
        if (updated.rowCount !== 1) throw new StaleProcessingLeaseError();
        const row = await jobRow(client, { familyId: claim.familyId, jobId: claim.id });
        if (row === undefined) throw new Error("Processing job disappeared");
        if (input.exchange !== undefined) {
          await appendProcessingExchangeInTransaction(client, {
            familyId: stored.family_id,
            documentVersionId: stored.document_version_id,
            jobId: stored.id,
            attempt: Number(stored.attempt_count),
            stage: (stored.current_stage ?? "structured_extraction") as ProcessingStage,
            outcome: input.errorCode === "AGENT_UNAVAILABLE" ? "unavailable" : "rejected",
            rejectionReason: input.rejectionReason ?? "schema_shape",
            exchange: input.exchange,
          });
        }
        await appendProcessingEventInTransaction(client, {
          familyId: stored.family_id,
          documentVersionId: stored.document_version_id,
          jobId: stored.id,
          code: exhausted ? "failed" : "retry_scheduled",
          attempt: Number(stored.attempt_count),
          occurredAt: input.now,
        });
        await auditAutomatedProcessingOutcome(
          client,
          claim,
          exhausted
            ? {
                action: "document.processing.failed",
                outcome: "dead_letter",
                errorCode: input.errorCode,
              }
            : {
                action: "document.processing.retry_scheduled",
                outcome: "retry_wait",
                errorCode: input.errorCode,
              },
          now,
        );
        return asJob(row);
      });
    },

    async getJob(scope) {
      assertIdentifier(scope.familyId, "familyId");
      assertIdentifier(scope.jobId, "jobId");
      const row = await jobRow(database, scope);
      return row === undefined ? null : asJob(row);
    },
  };
}
