import {
  DOCUMENT_INTELLIGENCE_RESULT_STATUSES,
  DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES,
  type DocumentIntelligenceStructuredResult,
} from "@veylta/contracts";
import { structuredResultFields } from "./answer-schema.js";
import { keyPattern, limits } from "./constants.js";
import { invalidOutput } from "./errors.js";
import {
  boundedString,
  canonicalDate,
  confidence,
  exactKeys,
  object,
  oneOf,
  optionalBoundedString,
  russianBoundedString,
} from "./field-parsers.js";
import { valueWithoutRepeatedUnit } from "./readings.js";
import type { SourceText } from "./source-text.js";

/** One generic summary result, source-bound; its status is settled later against its fact. */
export function parseStructuredResult(
  value: unknown,
  sourceText: SourceText,
): DocumentIntelligenceStructuredResult {
  const result = object(value);
  exactKeys(result, structuredResultFields);
  const resultKey = boundedString(result.resultKey, limits.keyCharacters);
  if (!keyPattern.test(resultKey)) invalidOutput("invalid_key");
  const type = oneOf(result.type, DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES);
  const status = oneOf(result.status, DOCUMENT_INTELLIGENCE_RESULT_STATUSES);
  const unit = optionalBoundedString(result.unit, 100);
  const proposedValue = optionalBoundedString(result.value, 500);
  if (unit !== null && proposedValue === null) invalidOutput("inconsistent_fields");
  const resultValue = proposedValue === null ? null : valueWithoutRepeatedUnit(proposedValue, unit);
  const source = sourceText.provenance(result.source, resultValue);
  return {
    resultKey,
    type,
    label: russianBoundedString(result.label, 200),
    value: resultValue,
    unit,
    code: optionalBoundedString(result.code, 100),
    lab: optionalBoundedString(result.lab, 200),
    specimen: optionalBoundedString(result.specimen, 200),
    date: canonicalDate(result.date),
    status,
    confidence: confidence(result.confidence),
    source,
  };
}
