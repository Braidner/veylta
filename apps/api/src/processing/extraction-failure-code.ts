import {
  ObjectStorageIntegrityError,
  ObjectStorageNotFoundError,
  ObjectStorageSecurityError,
  ObjectStorageValidationError,
} from "../storage/object-storage.js";
import { CodexDocumentIntelligenceError } from "./codex-document-intelligence-provider.js";
import { DocumentImageError } from "./document-images.js";
import { DocumentSourceUnavailableError } from "./document-source.js";
import { PdfTextExtractionError } from "./pdf-text-extractor.js";
import { InvalidProcessingOutputError } from "./processing-errors.js";
import type { ProcessingErrorCode } from "./processing-job-service.js";
import { SyntheticLabParseError } from "./synthetic-lab-parser.js";

/**
 * Which closed code a step's failure is recorded under. The reason a run failed is always
 * server-derived: every error a step may raise maps here, and anything unrecognised is the
 * generic extraction failure rather than a sentence borrowed from the model or the runtime.
 */
export function failureCode(error: unknown): ProcessingErrorCode {
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
  if (error instanceof SyntheticLabParseError) return "VALIDATION_FAILED";
  if (error instanceof CodexDocumentIntelligenceError) {
    return error.code === "PROVIDER_UNAVAILABLE" ? "AGENT_UNAVAILABLE" : "AGENT_OUTPUT_INVALID";
  }
  if (error instanceof InvalidProcessingOutputError) return "VALIDATION_FAILED";
  return "EXTRACTION_FAILED";
}
