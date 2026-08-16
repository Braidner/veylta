import { LAB_FACT_VALIDATION_ISSUES } from "@veylta/contracts";
import type { StrictLabExtractionFact, ValidationIssue } from "../synthetic-lab-parser.js";
import { factFields, referenceRangeFields } from "./answer-schema.js";
import { keyPattern, limits } from "./constants.js";
import { invalidOutput } from "./errors.js";
import {
  boundedString,
  canonicalTimestamp,
  confidence,
  exactKeys,
  object,
  optionalBoundedString,
} from "./field-parsers.js";
import { valueWithoutRepeatedUnit, verifiedNormalization } from "./readings.js";
import type { SourceText } from "./source-text.js";

/** Document-level defaults every fact inherits unless it carries its own explicit metadata. */
export interface DocumentMetadata {
  readonly laboratory: string | null;
  readonly resultedAt: string | null;
  readonly sampledAt: string | null;
  readonly specimenType: string | null;
}

export function parseDocumentMetadata(classification: Record<string, unknown>): DocumentMetadata {
  const metadata = {
    laboratory: optionalBoundedString(classification.laboratory, 200),
    resultedAt: canonicalTimestamp(classification.resultedAt),
    sampledAt: canonicalTimestamp(classification.sampledAt),
    specimenType: optionalBoundedString(classification.specimenType, 200),
  };
  if (
    metadata.sampledAt !== null &&
    metadata.resultedAt !== null &&
    metadata.sampledAt > metadata.resultedAt
  ) {
    invalidOutput("invalid_timestamp");
  }
  return metadata;
}

function parseReferenceRange(value: unknown): StrictLabExtractionFact["referenceRange"] {
  if (value === null) return null;
  const range = object(value);
  exactKeys(range, referenceRangeFields);
  if (range.laboratoryOutOfRange !== null && typeof range.laboratoryOutOfRange !== "boolean") {
    invalidOutput("schema_shape");
  }
  return {
    sourceText: optionalBoundedString(range.sourceText, 200),
    sourceLow: optionalBoundedString(range.sourceLow, 100),
    sourceHigh: optionalBoundedString(range.sourceHigh, 100),
    sourceUnit: optionalBoundedString(range.sourceUnit, 100),
    laboratoryOutOfRange: range.laboratoryOutOfRange as boolean | null,
  };
}

function parseValidationIssues(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value)) invalidOutput("schema_shape");
  const issues = value.map((issue) => {
    if (!LAB_FACT_VALIDATION_ISSUES.includes(issue as ValidationIssue))
      invalidOutput("schema_shape");
    return issue as ValidationIssue;
  });
  if (new Set(issues).size !== issues.length) invalidOutput("inconsistent_fields");
  return issues;
}

/** One laboratory fact for human review: printed reading, source line, verified proposals. */
export function parseFact(
  value: unknown,
  sourceText: SourceText,
  documentMetadata: DocumentMetadata,
): StrictLabExtractionFact {
  const fact = object(value);
  exactKeys(fact, factFields);
  const factKey = boundedString(fact.factKey, limits.keyCharacters);
  if (!keyPattern.test(factKey)) invalidOutput("invalid_key");
  const normalizedValue = optionalBoundedString(fact.proposedNormalizedValue, 100);
  const normalizedUnit = optionalBoundedString(fact.proposedNormalizedUnit, 100);
  const sampledAt = canonicalTimestamp(fact.proposedSampledAt) ?? documentMetadata.sampledAt;
  const resultedAt = canonicalTimestamp(fact.proposedResultedAt) ?? documentMetadata.resultedAt;
  if (sampledAt !== null && resultedAt !== null && sampledAt > resultedAt)
    invalidOutput("invalid_timestamp");
  const issues = parseValidationIssues(fact.validationIssues);
  const sourceUnit = boundedString(fact.sourceUnit, 100);
  const sourceValue = valueWithoutRepeatedUnit(boundedString(fact.sourceValue, 100), sourceUnit);
  const source = sourceText.provenance(fact.source, sourceValue);
  const normalization = verifiedNormalization(sourceValue, normalizedValue, normalizedUnit);
  return {
    factKey,
    sourceName: boundedString(fact.sourceName, 200),
    sourceValue,
    sourceUnit,
    proposedCanonicalCode: optionalBoundedString(fact.proposedCanonicalCode, 100),
    proposedNormalizedValue: normalization.value,
    proposedNormalizedUnit: normalization.unit,
    proposedSampledAt: sampledAt,
    proposedResultedAt: resultedAt,
    proposedSpecimenType:
      optionalBoundedString(fact.proposedSpecimenType, 200) ?? documentMetadata.specimenType,
    proposedLaboratory:
      optionalBoundedString(fact.proposedLaboratory, 200) ?? documentMetadata.laboratory,
    referenceRange: parseReferenceRange(fact.referenceRange),
    confidence: confidence(fact.confidence),
    validationIssues: issues,
    source,
  };
}
