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
import { loadAnalyteCatalogForPrompt } from "./analyte-mapping.js";
import { CodexDocumentIntelligenceError } from "./codex-document-intelligence-provider.js";
import { checkedDirectImage } from "./direct-image.js";
import {
  type DirectImageContentType,
  DocumentImageError,
  type DocumentPageImage,
  renderPdfPagesToImages,
} from "./document-images.js";
import type { DocumentIntelligenceProvider } from "./document-intelligence-provider.js";
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
  "advanceStage" | "claimNext" | "completeExtraction" | "recordFailure" | "releaseLease"
>;

export interface DocumentExtractionProcessorDependencies {
  database: DatabaseClient;
  storage: ObjectStorage;
  jobs?: DocumentExtractionJobCoordinator;
  extractText?: (
    bytes: Uint8Array,
    options?: PdfTextExtractionOptions,
  ) => Promise<ExtractedPageText[]>;
  /** Renders a PDF without a text layer into bounded page images for the model. */
  renderPdfImages?: (bytes: Uint8Array) => Promise<DocumentPageImage[]>;
  /** Validates a direct PNG/JPEG upload and returns it as one page image for the model. */
  checkImage?: (
    bytes: Uint8Array,
    contentType: DirectImageContentType,
  ) => Promise<DocumentPageImage>;
  parse?: (pages: readonly ExtractedPageText[]) => ParsedLabExtraction;
  intelligence?: DocumentIntelligenceProvider;
  now?: () => Date;
}

export interface ProcessNextDocumentExtractionInput {
  workerId: string;
  leaseDurationMs: number;
  retryDelayMs: number;
  /** Aborted when the worker is stopping; the run is handed back, not failed. */
  abortSignal?: AbortSignal;
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
  | { status: "stale"; jobId: string }
  | { status: "interrupted"; jobId: string };

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
       JOIN documents AS d
         ON d.family_id = v.family_id
        AND d.id = v.document_id
       JOIN patient_profiles AS p
         ON p.family_id = d.family_id
        AND p.id = d.patient_profile_id
        AND p.archived_at IS NULL
       JOIN document_blobs AS b
         ON b.family_id = v.family_id
        AND b.id = v.blob_id
       LEFT JOIN document_blob_content_types AS bt
         ON bt.family_id = b.family_id
        AND bt.blob_id = b.id
      WHERE v.family_id = $1 AND v.id = $2
        AND d.deleted_at IS NULL`,
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
      return "EXTRACTION_FAILED";
    }
  }
  if (error instanceof DocumentImageError) {
    return error.code === "INVALID_DOCUMENT" ? "INVALID_DOCUMENT" : "EXTRACTION_FAILED";
  }
  if (error instanceof SyntheticLabParseError) {
    return "VALIDATION_FAILED";
  }
  if (error instanceof CodexDocumentIntelligenceError) {
    return error.code === "PROVIDER_UNAVAILABLE" ? "AGENT_UNAVAILABLE" : "AGENT_OUTPUT_INVALID";
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
  const renderPdfImages = dependencies.renderPdfImages ?? renderPdfPagesToImages;
  const checkImage = dependencies.checkImage ?? checkedDirectImage;
  const parse = dependencies.parse ?? parseSyntheticLabPages;
  const intelligence = dependencies.intelligence;
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
        // A text layer travels as text; anything else travels as bounded page images that
        // Codex reads and transcribes itself. Local OCR is gone: one reader, one provenance.
        let pages: ExtractedPageText[] = [];
        let images: DocumentPageImage[] = [];
        if (source.contentType === "application/pdf") {
          try {
            pages = await extractText(bytes, { maxPdfBytes: source.byteSize });
          } catch (error) {
            if (!(error instanceof PdfTextExtractionError) || error.code !== "TEXT_LAYER_MISSING") {
              throw error;
            }
            images = await renderPdfImages(bytes);
          }
        } else {
          images = [await checkImage(bytes, source.contentType)];
        }
        await advance(jobs, claim, "document_classification", now);
        await advance(jobs, claim, "structured_extraction", now);
        const output =
          intelligence === undefined
            ? (() => {
                // Compatibility seam for isolated deterministic fixtures. The runtime worker
                // always supplies the Codex provider, and image sources need one.
                if (images.length > 0)
                  throw new SyntheticLabParseError("UNSUPPORTED_SYNTHETIC_FORMAT");
                requireSyntheticLabFixture(pages);
                return parse(pages);
              })()
            : await intelligence.analyze({
                contentType: source.contentType,
                pages,
                ...(images.length === 0 ? {} : { images }),
                analyteCatalog: await loadAnalyteCatalogForPrompt(dependencies.database),
                ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
              });
        await advance(jobs, claim, "validation", now);
        const completion = await jobs.completeExtraction(claim, output, validNow(now));
        return completedResult(claim, completion);
      } catch (error) {
        if (error instanceof StaleProcessingLeaseError) {
          return { status: "stale", jobId: claim.id };
        }
        if (input.abortSignal?.aborted) {
          // The worker is stopping, not the document failing: give the job straight back.
          await jobs.releaseLease(claim, validNow(now));
          return { status: "interrupted", jobId: claim.id };
        }
        const errorCode = failureCode(error);
        const diagnostics =
          error instanceof CodexDocumentIntelligenceError && error.exchange !== null
            ? { rejectionReason: error.reason, exchange: error.exchange }
            : {};
        try {
          const job = await jobs.recordFailure(claim, {
            now: validNow(now),
            errorCode,
            retryDelayMs: input.retryDelayMs,
            ...diagnostics,
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
