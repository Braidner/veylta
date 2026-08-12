import { createHash } from "node:crypto";
import {
  MAX_SYNTHETIC_DOCUMENT_BYTES,
  OBJECT_STORAGE_CONTRACT_VERSION,
  type SyntheticDocumentContentType,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import {
  createObjectStorageKey,
  type ObjectStorage,
  ObjectStorageIntegrityError,
  ObjectStorageNotFoundError,
  ObjectStorageSecurityError,
  ObjectStorageValidationError,
} from "../storage/object-storage.js";
import {
  type DirectImageContentType,
  extractImageTextWithLocalSyntheticOcr,
  ImageOcrExtractionError,
} from "./image-ocr-extractor.js";
import { extractPdfTextWithLocalSyntheticOcr, PdfOcrExtractionError } from "./pdf-ocr-extractor.js";
import {
  extractPdfTextLayer,
  PdfTextExtractionError,
  type PdfTextExtractionOptions,
} from "./pdf-text-extractor.js";
import {
  createProcessingJobService,
  InvalidProcessingOutputError,
  type LeasedProcessingJob,
  type ProcessingCompletion,
  type ProcessingErrorCode,
  type ProcessingJob,
  type ProcessingJobService,
  type ProcessingStage,
  StaleProcessingLeaseError,
  type TransactionalProcessingDatabase,
} from "./processing-job-service.js";
import {
  type ExtractedPageText,
  type ParsedLabExtraction,
  parseSyntheticLabPages,
  requireSyntheticLabFixture,
  SyntheticLabParseError,
} from "./synthetic-lab-parser.js";

export type DocumentExtractionJobCoordinator = Pick<
  ProcessingJobService,
  "advanceStage" | "claimNext" | "completeExtraction" | "recordFailure"
>;

export interface DocumentExtractionProcessorDependencies {
  database: DatabaseClient;
  storage: ObjectStorage;
  jobs?: DocumentExtractionJobCoordinator;
  extractText?: (
    bytes: Uint8Array,
    options?: PdfTextExtractionOptions,
  ) => Promise<ExtractedPageText[]>;
  extractScannedPdf?: (bytes: Uint8Array) => Promise<ExtractedPageText[]>;
  extractImage?: (
    bytes: Uint8Array,
    contentType: DirectImageContentType,
  ) => Promise<ExtractedPageText[]>;
  parse?: (pages: readonly ExtractedPageText[]) => ParsedLabExtraction;
  now?: () => Date;
}

export interface ProcessNextDocumentExtractionInput {
  workerId: string;
  leaseDurationMs: number;
  retryDelayMs: number;
}

export type ProcessNextDocumentExtractionResult =
  | { status: "idle" }
  | {
      status: "completed";
      jobId: string;
      extractionRunId: string;
      factCount: number;
      needsReviewCount: number;
    }
  | {
      status: "retry_wait" | "dead_letter";
      jobId: string;
      errorCode: ProcessingErrorCode;
    }
  | { status: "stale"; jobId: string };

export interface DocumentExtractionProcessor {
  processNext(
    input: ProcessNextDocumentExtractionInput,
  ): Promise<ProcessNextDocumentExtractionResult>;
}

interface DocumentSourceRow {
  storage_key: string;
  content_type: string;
  byte_size: number;
  sha256: string;
}

interface DocumentSource {
  storageKey: ReturnType<typeof createObjectStorageKey>;
  contentType: SyntheticDocumentContentType;
  byteSize: number;
  sha256: string;
}

class DocumentSourceUnavailableError extends Error {}

function validNow(now: () => Date): Date {
  const value = now();
  if (!Number.isFinite(value.getTime()))
    throw new Error("Processor clock returned an invalid date");
  return value;
}

function transactionalDatabase(database: DatabaseClient): TransactionalProcessingDatabase {
  if (!("transaction" in database) || typeof database.transaction !== "function") {
    throw new Error("A transactional database is required when a job coordinator is not supplied");
  }
  return database as TransactionalProcessingDatabase;
}

async function sourceForClaim(
  database: DatabaseClient,
  claim: LeasedProcessingJob,
): Promise<DocumentSource> {
  const result = await database.query<DocumentSourceRow>(
    `SELECT b.storage_key, COALESCE(bt.content_type, b.content_type) AS content_type,
            b.byte_size, b.sha256
       FROM document_versions AS v
       JOIN document_blobs AS b
         ON b.family_id = v.family_id
        AND b.id = v.blob_id
       LEFT JOIN document_blob_content_types AS bt
         ON bt.family_id = b.family_id
        AND bt.blob_id = b.id
      WHERE v.family_id = $1 AND v.id = $2`,
    [claim.familyId, claim.documentVersionId],
  );
  const row = result.rows[0];
  const byteSize = Number(row?.byte_size);
  if (
    result.rowCount !== 1 ||
    row === undefined ||
    !["application/pdf", "image/png", "image/jpeg"].includes(row.content_type) ||
    !Number.isSafeInteger(byteSize) ||
    byteSize < 5 ||
    byteSize > MAX_SYNTHETIC_DOCUMENT_BYTES ||
    !/^[a-f0-9]{64}$/.test(row.sha256)
  ) {
    throw new DocumentSourceUnavailableError();
  }
  try {
    return {
      storageKey: createObjectStorageKey(row.storage_key),
      contentType: row.content_type as SyntheticDocumentContentType,
      byteSize,
      sha256: row.sha256,
    };
  } catch (error) {
    if (error instanceof ObjectStorageValidationError) throw new DocumentSourceUnavailableError();
    throw error;
  }
}

async function exactBodyBytes(
  body: NodeJS.ReadableStream & AsyncIterable<unknown>,
  source: DocumentSource,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  const digest = createHash("sha256");
  for await (const chunk of body) {
    const bytes =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as Uint8Array);
    byteSize += bytes.byteLength;
    if (byteSize > source.byteSize || byteSize > MAX_SYNTHETIC_DOCUMENT_BYTES) {
      throw new DocumentSourceUnavailableError();
    }
    digest.update(bytes);
    chunks.push(bytes);
  }
  if (byteSize !== source.byteSize || digest.digest("hex") !== source.sha256) {
    throw new DocumentSourceUnavailableError();
  }
  return Buffer.concat(chunks, byteSize);
}

async function loadDocumentBytes(
  storage: ObjectStorage,
  source: DocumentSource,
): Promise<Uint8Array> {
  const read = await storage.get(source.storageKey, {
    contentType: source.contentType,
    byteSize: source.byteSize,
    sha256: source.sha256,
  });
  if (
    read.metadata.contractVersion !== OBJECT_STORAGE_CONTRACT_VERSION ||
    read.metadata.key !== source.storageKey ||
    read.metadata.contentType !== source.contentType ||
    read.metadata.byteSize !== source.byteSize ||
    read.metadata.sha256 !== source.sha256
  ) {
    read.body.destroy();
    throw new DocumentSourceUnavailableError();
  }
  return exactBodyBytes(read.body, source);
}

function failureCode(error: unknown): ProcessingErrorCode {
  if (
    error instanceof DocumentSourceUnavailableError ||
    error instanceof ObjectStorageNotFoundError ||
    error instanceof ObjectStorageIntegrityError ||
    error instanceof ObjectStorageSecurityError ||
    error instanceof ObjectStorageValidationError
  ) {
    return "DOCUMENT_UNAVAILABLE";
  }
  if (error instanceof PdfTextExtractionError) {
    if (error.code === "INVALID_PDF") return "INVALID_DOCUMENT";
    if (error.code === "TEXT_LAYER_MISSING" || error.code === "PDF_LIMIT_EXCEEDED") {
      return "UNSUPPORTED_DOCUMENT";
    }
  }
  if (error instanceof PdfOcrExtractionError) {
    if (error.code === "INVALID_PDF") return "INVALID_DOCUMENT";
    if (error.code === "PDF_LIMIT_EXCEEDED" || error.code === "OCR_FAILED") {
      return "UNSUPPORTED_DOCUMENT";
    }
  }
  if (error instanceof ImageOcrExtractionError) {
    if (error.code === "INVALID_IMAGE") return "INVALID_DOCUMENT";
    if (error.code === "IMAGE_LIMIT_EXCEEDED" || error.code === "OCR_FAILED") {
      return "UNSUPPORTED_DOCUMENT";
    }
  }
  if (error instanceof SyntheticLabParseError) {
    return error.code === "UNSUPPORTED_SYNTHETIC_FORMAT"
      ? "UNSUPPORTED_DOCUMENT"
      : "VALIDATION_FAILED";
  }
  if (error instanceof InvalidProcessingOutputError) return "VALIDATION_FAILED";
  return "EXTRACTION_FAILED";
}

async function advance(
  jobs: DocumentExtractionJobCoordinator,
  claim: LeasedProcessingJob,
  stage: ProcessingStage,
  now: () => Date,
): Promise<void> {
  await jobs.advanceStage(claim, stage, validNow(now));
}

function completedResult(
  claim: LeasedProcessingJob,
  completion: ProcessingCompletion,
): ProcessNextDocumentExtractionResult {
  return {
    status: "completed",
    jobId: claim.id,
    extractionRunId: completion.extractionRunId,
    factCount: completion.factCount,
    needsReviewCount: completion.needsReviewCount,
  };
}

function failureResult(
  job: ProcessingJob,
  errorCode: ProcessingErrorCode,
): ProcessNextDocumentExtractionResult {
  if (job.state !== "retry_wait" && job.state !== "dead_letter") {
    throw new Error("Failure transition returned an invalid job state");
  }
  return { status: job.state, jobId: job.id, errorCode };
}

export function createDocumentExtractionProcessor(
  dependencies: DocumentExtractionProcessorDependencies,
): DocumentExtractionProcessor {
  const jobs =
    dependencies.jobs ?? createProcessingJobService(transactionalDatabase(dependencies.database));
  const extractText = dependencies.extractText ?? extractPdfTextLayer;
  const extractScannedPdf = dependencies.extractScannedPdf ?? extractPdfTextWithLocalSyntheticOcr;
  const extractImage = dependencies.extractImage ?? extractImageTextWithLocalSyntheticOcr;
  const parse = dependencies.parse ?? parseSyntheticLabPages;
  const now = dependencies.now ?? (() => new Date());

  return {
    async processNext(input) {
      const claim = await jobs.claimNext({
        workerId: input.workerId,
        now: validNow(now),
        leaseDurationMs: input.leaseDurationMs,
      });
      if (claim === null) return { status: "idle" };

      try {
        const source = await sourceForClaim(dependencies.database, claim);
        const bytes = await loadDocumentBytes(dependencies.storage, source);
        await advance(jobs, claim, "text_extraction", now);
        let pages: ExtractedPageText[];
        if (source.contentType === "application/pdf") {
          try {
            pages = await extractText(bytes, { maxPdfBytes: source.byteSize });
          } catch (error) {
            if (!(error instanceof PdfTextExtractionError) || error.code !== "TEXT_LAYER_MISSING") {
              throw error;
            }
            pages = await extractScannedPdf(bytes);
          }
        } else {
          pages = await extractImage(bytes, source.contentType);
        }
        await advance(jobs, claim, "document_classification", now);
        requireSyntheticLabFixture(pages);
        await advance(jobs, claim, "structured_extraction", now);
        const output = parse(pages);
        await advance(jobs, claim, "validation", now);
        const completion = await jobs.completeExtraction(claim, output, validNow(now));
        return completedResult(claim, completion);
      } catch (error) {
        if (error instanceof StaleProcessingLeaseError) {
          return { status: "stale", jobId: claim.id };
        }
        const errorCode = failureCode(error);
        try {
          const job = await jobs.recordFailure(claim, {
            now: validNow(now),
            errorCode,
            retryDelayMs: input.retryDelayMs,
          });
          return failureResult(job, errorCode);
        } catch (failureError) {
          if (failureError instanceof StaleProcessingLeaseError) {
            return { status: "stale", jobId: claim.id };
          }
          throw failureError;
        }
      }
    },
  };
}

export async function processNextDocumentExtraction(
  dependencies: DocumentExtractionProcessorDependencies,
  input: ProcessNextDocumentExtractionInput,
): Promise<ProcessNextDocumentExtractionResult> {
  return createDocumentExtractionProcessor(dependencies).processNext(input);
}
