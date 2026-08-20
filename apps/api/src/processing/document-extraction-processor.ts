import type { DatabaseClient } from "../database/pool.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import { loadAnalyteCatalogForPrompt } from "./analyte-mapping.js";
import { CodexDocumentIntelligenceError } from "./codex-document-intelligence-provider.js";
import { checkedDirectImage } from "./direct-image.js";
import {
  type DirectImageContentType,
  type DocumentImageRenderOptions,
  type DocumentPageImage,
  renderPdfPagesToImages,
} from "./document-images.js";
import type { DocumentIntelligenceProvider } from "./document-intelligence-provider.js";
import { pagesAlreadyRead } from "./document-page-evidence.js";
import { loadDocumentBytes, sourceForClaim } from "./document-source.js";
import { failureCode } from "./extraction-failure-code.js";
import { readImagePages } from "./extraction-merge.js";
import {
  type ExtractedPdfPage,
  extractPdfTextLayer,
  PdfTextExtractionError,
  type PdfTextExtractionOptions,
} from "./pdf-text-extractor.js";
import {
  createProcessingJobService,
  type LeasedProcessingJob,
  type ProcessingCompletion,
  type ProcessingErrorCode,
  type ProcessingExtractionOutput,
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
  ) => Promise<ExtractedPdfPage[]>;
  /** Renders a whole PDF, or the pages named, into bounded page images for the model. */
  renderPdfImages?: (
    bytes: Uint8Array,
    options?: DocumentImageRenderOptions,
  ) => Promise<DocumentPageImage[]>;
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
        let pages: ExtractedPdfPage[] = [];
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
        let output: ProcessingExtractionOutput;
        if (intelligence === undefined) {
          // Compatibility seam for isolated deterministic fixtures. The runtime worker
          // always supplies the Codex provider, and image sources need one.
          if (images.length > 0) throw new SyntheticLabParseError("UNSUPPORTED_SYNTHETIC_FORMAT");
          requireSyntheticLabFixture(pages);
          output = parse(pages);
        } else {
          const request = {
            contentType: source.contentType,
            analyteCatalog: await loadAnalyteCatalogForPrompt(dependencies.database),
            ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
          };
          const analyzed = await intelligence.analyze({
            ...request,
            pages,
            ...(images.length === 0 ? {} : { images }),
          });
          // A page that carries a picture and hardly any text was read by nothing: a second,
          // page-scoped run reads it as an image into the same analysis. One run sends text
          // or images, never both, so this is a run of its own. A page an earlier run read
          // something from keeps the provenance that reading cites, so it is never sent.
          output =
            images.length > 0
              ? analyzed
              : await readImagePages({
                  analyzed,
                  pages,
                  alreadyRead: await pagesAlreadyRead(dependencies.database, claim),
                  bytes,
                  render: renderPdfImages,
                  analyze: (attached) =>
                    intelligence.analyze({ ...request, pages: [], images: attached }),
                });
        }
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
