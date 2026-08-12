export const HTTP_API_VERSION = "v1" as const;
export const OBJECT_STORAGE_CONTRACT_VERSION = "object-storage/v1" as const;
export const LAB_EXTRACTION_SCHEMA_VERSION = "lab-extraction/v1" as const;
export const FAMILY_PROFILE_CONTRACT_VERSION = "family-profile/v1" as const;
export const DOCUMENT_CONTRACT_VERSION = "document/v3" as const;
export const MAX_SYNTHETIC_PDF_BYTES = 5 * 1024 * 1024;

export const DOCUMENT_PROCESSING_STATES = [
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
] as const;

export const DOCUMENT_PROCESSING_FAILURE_CATEGORIES = [
  "document_unavailable",
  "invalid_document",
  "unsupported_document",
  "extraction_failed",
  "validation_failed",
  "attempts_exhausted",
] as const;

export const LAB_FACT_VALIDATION_ISSUES = [
  "LOW_CONFIDENCE",
  "AMBIGUOUS_UNIT",
  "MISSING_UNIT",
  "INVALID_VALUE",
  "INVALID_DATE",
  "INVALID_REFERENCE_RANGE",
  "UNSUPPORTED_ANALYTE",
] as const;

export const FACT_REVIEW_DECISIONS = ["confirm", "correct", "reject"] as const;
export const FACT_REVIEW_OUTCOMES = ["confirmed", "corrected", "rejected"] as const;

export interface HealthStatus {
  status: "ok" | "unavailable";
  service: "api" | "worker";
  version: string;
}

export type FamilyRole = "owner" | "adult_member" | "caregiver";
export type PatientProfileKind = "adult" | "dependent";

export interface FamilySummary {
  id: string;
  displayName: string;
  role: FamilyRole;
  createdAt: string;
}

export interface PatientProfileSummary {
  id: string;
  familyId: string;
  displayName: string;
  kind: PatientProfileKind;
  createdAt: string;
}

export interface DemoRegistrationRequest {
  displayName: string;
  familyName: string;
  profileName: string;
}

export interface DemoRegistrationResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  family: FamilySummary;
  profile: PatientProfileSummary;
}

export interface ProfileListResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  items: PatientProfileSummary[];
}

export interface ProfileCreateResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  profile: PatientProfileSummary;
}

export interface SessionFamily extends FamilySummary {
  profiles: PatientProfileSummary[];
}

export interface SessionResponse {
  contractVersion: typeof FAMILY_PROFILE_CONTRACT_VERSION;
  user: {
    id: string;
    displayName: string;
  };
  families: SessionFamily[];
}

export type DocumentStatus = "uploaded";
export type DocumentProcessingState = (typeof DOCUMENT_PROCESSING_STATES)[number];
export type DocumentProcessingFailureCategory =
  (typeof DOCUMENT_PROCESSING_FAILURE_CATEGORIES)[number];

export interface DocumentProcessingNotStarted {
  readonly state: "not_started";
}

export interface DocumentProcessingQueued {
  readonly state: "queued";
  readonly updatedAt: string;
}

export interface DocumentProcessingActive {
  readonly state:
    | "security_check"
    | "text_extraction"
    | "document_classification"
    | "structured_extraction"
    | "validation";
  readonly updatedAt: string;
}

export interface DocumentProcessingAwaitingReview {
  readonly state: "awaiting_review";
  readonly updatedAt: string;
  readonly factCount: number;
  readonly needsReviewCount: number;
}

export interface DocumentProcessingCompleted {
  readonly state: "completed";
  readonly updatedAt: string;
  readonly factCount: number;
}

export interface DocumentProcessingFailed {
  readonly state: "failed";
  readonly updatedAt: string;
  readonly category: DocumentProcessingFailureCategory;
  readonly retryAllowed: boolean;
}

export type DocumentProcessingStatus =
  | DocumentProcessingNotStarted
  | DocumentProcessingQueued
  | DocumentProcessingActive
  | DocumentProcessingAwaitingReview
  | DocumentProcessingCompleted
  | DocumentProcessingFailed;

export interface DocumentSummary {
  id: string;
  familyId: string;
  profileId: string;
  status: DocumentStatus;
  originalFilename: string;
  contentType: "application/pdf";
  byteSize: number;
  sha256: string;
  uploadedAt: string;
  duplicate: {
    possible: boolean;
    documentId: string | null;
    profileId: string | null;
  };
  processing: DocumentProcessingStatus;
}

export interface DocumentResponse {
  contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  document: DocumentSummary;
}

export interface DocumentProcessingResponse {
  readonly contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  readonly documentId: string;
  readonly processing: DocumentProcessingStatus;
}

export interface DocumentProcessingRetryResponse {
  readonly contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  readonly documentId: string;
  readonly processing: DocumentProcessingQueued;
}

export type LabFactValidationIssue = (typeof LAB_FACT_VALIDATION_ISSUES)[number];
export type ExtractedFactReviewStatus = "extracted" | "needs_review" | "confirmed" | "rejected";
export type FactReviewDecision = (typeof FACT_REVIEW_DECISIONS)[number];
export type FactReviewOutcome = (typeof FACT_REVIEW_OUTCOMES)[number];

export interface LabFactReferenceRange {
  readonly sourceText: string | null;
  readonly sourceLow: string | null;
  readonly sourceHigh: string | null;
  readonly sourceUnit: string | null;
  readonly laboratoryOutOfRange: boolean | null;
}

export interface LabFactPageSource {
  readonly pageNumber: number;
  readonly fragment: string;
}

export interface LabExtractionFact {
  readonly factKey: string;
  readonly sourceName: string;
  readonly sourceValue: string;
  readonly sourceUnit: string;
  readonly proposedCanonicalCode: string | null;
  readonly proposedNormalizedValue: string | null;
  readonly proposedNormalizedUnit: string | null;
  readonly proposedSampledAt: string | null;
  readonly proposedResultedAt: string | null;
  readonly proposedSpecimenType: string | null;
  readonly proposedLaboratory: string | null;
  readonly referenceRange: LabFactReferenceRange | null;
  readonly confidence: number;
  readonly validationIssues: readonly LabFactValidationIssue[];
  readonly source: LabFactPageSource;
}

export interface LabExtractionResult {
  readonly schemaVersion: typeof LAB_EXTRACTION_SCHEMA_VERSION;
  readonly extractorVersion: string;
  readonly items: readonly LabExtractionFact[];
}

export interface ExtractedLabFact extends LabExtractionFact {
  readonly id: string;
  readonly factVersion: number;
  readonly reviewStatus: ExtractedFactReviewStatus;
  /** Null until an explicit immutable review decision has been stored. */
  readonly review: ExtractedFactReviewSummary | null;
  readonly source: LabFactPageSource & {
    readonly documentVersionId: string;
  };
}

export interface DocumentFactsResponse {
  readonly schemaVersion: typeof LAB_EXTRACTION_SCHEMA_VERSION;
  readonly extractionRunId: string;
  readonly extractorVersion: string;
  readonly items: readonly ExtractedLabFact[];
}

export interface FactReviewCorrection {
  readonly sourceName: string;
  readonly sourceValue: string;
  readonly sourceUnit: string;
}

/** The immutable final decision exposed with its source fact on authorized reads. */
export interface ExtractedFactReviewSummary {
  readonly id: string;
  readonly outcome: FactReviewOutcome;
  readonly decidedAt: string;
  readonly observationId: string | null;
  /** Present only when the final decision is a correction. */
  readonly correction: FactReviewCorrection | null;
}

export interface FactReviewCommand {
  readonly factVersion: number;
  readonly decision: FactReviewDecision;
  readonly correction?: FactReviewCorrection;
}

export interface FactReviewSummary {
  readonly id: string;
  readonly factId: string;
  readonly factVersion: number;
  readonly outcome: FactReviewOutcome;
  readonly decidedAt: string;
  readonly observationId: string | null;
}

export interface FactReviewResponse {
  readonly contractVersion: typeof DOCUMENT_CONTRACT_VERSION;
  readonly review: FactReviewSummary;
}

const nullableShortStringSchema = {
  anyOf: [{ type: "string", minLength: 1, maxLength: 200 }, { type: "null" }],
} as const;

const nullableValueStringSchema = {
  anyOf: [{ type: "string", minLength: 1, maxLength: 120 }, { type: "null" }],
} as const;

const valueStringSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
} as const;

const nullableTimestampSchema = {
  anyOf: [
    {
      type: "string",
      minLength: 20,
      maxLength: 35,
      pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,9})?Z$",
    },
    { type: "null" },
  ],
} as const;

const reviewTextSchema = {
  type: "string",
  minLength: 1,
  maxLength: 200,
  pattern: "^\\S(?:[^\\r\\n]*\\S)?$",
} as const;

export const FACT_REVIEW_COMMAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["factVersion", "decision"],
  properties: {
    factVersion: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
    decision: { type: "string", enum: FACT_REVIEW_DECISIONS },
    correction: {
      type: "object",
      additionalProperties: false,
      required: ["sourceName", "sourceValue", "sourceUnit"],
      properties: {
        sourceName: reviewTextSchema,
        sourceValue: { ...reviewTextSchema, maxLength: 100 },
        sourceUnit: { ...reviewTextSchema, maxLength: 100 },
      },
    },
  },
  allOf: [
    {
      if: { properties: { decision: { const: "correct" } }, required: ["decision"] },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema conditionals require `then`.
      then: { required: ["correction"] },
      else: { not: { required: ["correction"] } },
    },
  ],
} as const;

export const LAB_EXTRACTION_RESULT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "urn:veylta:schema:lab-extraction:v1",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "extractorVersion", "items"],
  properties: {
    schemaVersion: { const: LAB_EXTRACTION_SCHEMA_VERSION },
    extractorVersion: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      pattern: "^[a-z0-9][a-z0-9._/-]*$",
    },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "factKey",
          "sourceName",
          "sourceValue",
          "sourceUnit",
          "proposedCanonicalCode",
          "proposedNormalizedValue",
          "proposedNormalizedUnit",
          "proposedSampledAt",
          "proposedResultedAt",
          "proposedSpecimenType",
          "proposedLaboratory",
          "referenceRange",
          "confidence",
          "validationIssues",
          "source",
        ],
        properties: {
          factKey: {
            type: "string",
            minLength: 1,
            maxLength: 120,
            pattern: "^[a-z0-9][a-z0-9._-]*$",
          },
          sourceName: { type: "string", minLength: 1, maxLength: 200 },
          sourceValue: { type: "string", minLength: 1, maxLength: 120 },
          sourceUnit: valueStringSchema,
          proposedCanonicalCode: {
            anyOf: [
              {
                type: "string",
                minLength: 1,
                maxLength: 120,
                pattern: "^[a-z0-9][a-z0-9._-]*$",
              },
              { type: "null" },
            ],
          },
          proposedNormalizedValue: nullableValueStringSchema,
          proposedNormalizedUnit: nullableValueStringSchema,
          proposedSampledAt: nullableTimestampSchema,
          proposedResultedAt: nullableTimestampSchema,
          proposedSpecimenType: nullableShortStringSchema,
          proposedLaboratory: nullableShortStringSchema,
          referenceRange: {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: [
                  "sourceText",
                  "sourceLow",
                  "sourceHigh",
                  "sourceUnit",
                  "laboratoryOutOfRange",
                ],
                properties: {
                  sourceText: nullableShortStringSchema,
                  sourceLow: nullableValueStringSchema,
                  sourceHigh: nullableValueStringSchema,
                  sourceUnit: nullableValueStringSchema,
                  laboratoryOutOfRange: {
                    anyOf: [{ type: "boolean" }, { type: "null" }],
                  },
                },
              },
              { type: "null" },
            ],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          validationIssues: {
            type: "array",
            maxItems: LAB_FACT_VALIDATION_ISSUES.length,
            uniqueItems: true,
            items: { type: "string", enum: LAB_FACT_VALIDATION_ISSUES },
          },
          source: {
            type: "object",
            additionalProperties: false,
            required: ["pageNumber", "fragment"],
            properties: {
              pageNumber: { type: "integer", minimum: 1, maximum: 1_000 },
              fragment: { type: "string", minLength: 1, maxLength: 2_000 },
            },
          },
        },
      },
    },
  },
} as const;
