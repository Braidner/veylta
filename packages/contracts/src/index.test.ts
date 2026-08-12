import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCUMENT_CONTRACT_VERSION,
  DOCUMENT_PROCESSING_FAILURE_CATEGORIES,
  DOCUMENT_PROCESSING_STATES,
  type DocumentFactsResponse,
  type DocumentProcessingResponse,
  type DocumentProcessingRetryResponse,
  type DocumentResponse,
  FAMILY_PROFILE_CONTRACT_VERSION,
  HTTP_API_VERSION,
  LAB_EXTRACTION_RESULT_SCHEMA,
  LAB_EXTRACTION_SCHEMA_VERSION,
  LAB_FACT_VALIDATION_ISSUES,
  type LabExtractionResult,
  MAX_SYNTHETIC_PDF_BYTES,
  OBJECT_STORAGE_CONTRACT_VERSION,
} from "./index.js";

test("public contracts carry explicit versions", () => {
  assert.equal(HTTP_API_VERSION, "v1");
  assert.equal(DOCUMENT_CONTRACT_VERSION, "document/v2");
  assert.equal(FAMILY_PROFILE_CONTRACT_VERSION, "family-profile/v1");
  assert.equal(OBJECT_STORAGE_CONTRACT_VERSION, "object-storage/v1");
  assert.equal(LAB_EXTRACTION_SCHEMA_VERSION, "lab-extraction/v1");
  assert.equal(MAX_SYNTHETIC_PDF_BYTES, 5 * 1024 * 1024);
});

test("document processing exposes only supported observable states and sanitized failures", () => {
  assert.deepEqual(DOCUMENT_PROCESSING_STATES, [
    "not_started",
    "queued",
    "security_check",
    "text_extraction",
    "document_classification",
    "structured_extraction",
    "validation",
    "awaiting_review",
    "completed",
    "failed",
  ]);
  assert.deepEqual(DOCUMENT_PROCESSING_FAILURE_CATEGORIES, [
    "document_unavailable",
    "invalid_document",
    "unsupported_document",
    "extraction_failed",
    "validation_failed",
    "attempts_exhausted",
  ]);

  const failed = {
    state: "failed",
    updatedAt: "2026-08-12T12:00:00.000Z",
    category: "attempts_exhausted",
    retryAllowed: true,
  } as const;
  const response = {
    contractVersion: DOCUMENT_CONTRACT_VERSION,
    documentId: "10000000-0000-4000-8000-000000000001",
    processing: failed,
  } satisfies DocumentProcessingResponse;
  const retry = {
    contractVersion: DOCUMENT_CONTRACT_VERSION,
    documentId: response.documentId,
    processing: {
      state: "queued",
      updatedAt: "2026-08-12T12:00:01.000Z",
    },
  } satisfies DocumentProcessingRetryResponse;

  assert.equal(response.processing.category, "attempts_exhausted");
  assert.equal(retry.processing.state, "queued");
  assert.equal("message" in response.processing, false);
});

test("document v2 embeds discriminated processing status without changing original status", () => {
  const response = {
    contractVersion: DOCUMENT_CONTRACT_VERSION,
    document: {
      id: "10000000-0000-4000-8000-000000000001",
      familyId: "10000000-0000-4000-8000-000000000002",
      profileId: "10000000-0000-4000-8000-000000000003",
      status: "uploaded",
      originalFilename: "synthetic.pdf",
      contentType: "application/pdf",
      byteSize: 128,
      sha256: "a".repeat(64),
      uploadedAt: "2026-08-12T12:00:00.000Z",
      duplicate: { possible: false, documentId: null, profileId: null },
      processing: {
        state: "awaiting_review",
        updatedAt: "2026-08-12T12:00:02.000Z",
        factCount: 2,
        needsReviewCount: 1,
      },
    },
  } satisfies DocumentResponse;

  assert.equal(response.document.status, "uploaded");
  assert.equal(response.document.processing.state, "awaiting_review");
});

test("lab extraction contract preserves immutable source data and page provenance", () => {
  assert.deepEqual(LAB_FACT_VALIDATION_ISSUES, [
    "LOW_CONFIDENCE",
    "AMBIGUOUS_UNIT",
    "MISSING_UNIT",
    "INVALID_VALUE",
    "INVALID_DATE",
    "INVALID_REFERENCE_RANGE",
    "UNSUPPORTED_ANALYTE",
  ]);

  const extraction = {
    schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
    extractorVersion: "synthetic-lab-text/v1",
    items: [
      {
        factKey: "synthetic-analyte-a",
        sourceName: "SYNTHETIC_ANALYTE_A",
        sourceValue: "7.0",
        sourceUnit: "synthetic-unit",
        proposedCanonicalCode: "synthetic-analyte-a",
        proposedNormalizedValue: null,
        proposedNormalizedUnit: null,
        proposedSampledAt: "2026-08-10T08:00:00.000Z",
        proposedResultedAt: "2026-08-10T10:00:00.000Z",
        proposedSpecimenType: "synthetic specimen",
        proposedLaboratory: "Synthetic Laboratory",
        referenceRange: {
          sourceText: "5.0–8.0 synthetic-unit",
          sourceLow: "5.0",
          sourceHigh: "8.0",
          sourceUnit: "synthetic-unit",
          laboratoryOutOfRange: false,
        },
        confidence: 0.6,
        validationIssues: ["LOW_CONFIDENCE", "AMBIGUOUS_UNIT"],
        source: { pageNumber: 1, fragment: "SYNTHETIC_ANALYTE_A 7.0 synthetic-unit" },
      },
    ],
  } as const satisfies LabExtractionResult;

  const response = {
    schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
    extractionRunId: "10000000-0000-4000-8000-000000000004",
    extractorVersion: extraction.extractorVersion,
    items: [
      {
        ...extraction.items[0],
        id: "10000000-0000-4000-8000-000000000005",
        factVersion: 1,
        reviewStatus: "needs_review",
        source: {
          ...extraction.items[0].source,
          documentVersionId: "10000000-0000-4000-8000-000000000006",
        },
      },
    ],
  } as const satisfies DocumentFactsResponse;

  assert.equal(response.items[0].source.pageNumber, 1);
  assert.equal(response.items[0].source.documentVersionId.endsWith("6"), true);
  assert.equal(response.items[0].sourceValue, "7.0");
  assert.equal(response.items[0].proposedNormalizedValue, null);
});

test("lab extraction JSON Schema is closed and constrains provenance and confidence", () => {
  assert.equal(LAB_EXTRACTION_RESULT_SCHEMA.$id, "urn:veylta:schema:lab-extraction:v1");
  assert.equal(LAB_EXTRACTION_RESULT_SCHEMA.additionalProperties, false);
  assert.deepEqual(LAB_EXTRACTION_RESULT_SCHEMA.required, [
    "schemaVersion",
    "extractorVersion",
    "items",
  ]);

  const factSchema = LAB_EXTRACTION_RESULT_SCHEMA.properties.items.items;
  assert.equal(factSchema.additionalProperties, false);
  assert.deepEqual(factSchema.properties.validationIssues.items.enum, LAB_FACT_VALIDATION_ISSUES);
  assert.equal(factSchema.properties.confidence.minimum, 0);
  assert.equal(factSchema.properties.confidence.maximum, 1);
  assert.equal(factSchema.properties.source.additionalProperties, false);
  assert.equal(factSchema.properties.source.properties.pageNumber.minimum, 1);
  assert.equal(factSchema.properties.source.properties.fragment.maxLength, 2_000);
});
