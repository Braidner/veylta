// The closed JSON schema Codex must answer in. Both variants share one shape; the vision variant
// additionally demands a transcription of every attached page, which fragments then bind to.
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_INTELLIGENCE_RESULT_STATUSES,
  DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES,
  LAB_FACT_VALIDATION_ISSUES,
} from "@veylta/contracts";
import type { AnalyteCatalogEntry } from "../document-intelligence-provider.js";
import { limits } from "./constants.js";

const canonicalTimestampPattern =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$";
const russianTextPattern = "^[\\s\\S]*[А-Яа-яЁё][\\s\\S]*$";
const keyPattern = "^[a-z0-9]+(?:-[a-z0-9]+)*$";
const datePattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";

const nullableString = (maximum: number) => ({
  anyOf: [
    { type: "string", minLength: 1, maxLength: maximum, pattern: ".*\\S.*" },
    { type: "null" },
  ],
});
const nullableDate = { anyOf: [{ type: "string", pattern: datePattern }, { type: "null" }] };
const nullableTimestamp = {
  anyOf: [
    {
      type: "string",
      pattern: canonicalTimestampPattern,
      description:
        "Canonical UTC timestamp. For an explicit source date without a time, use 00:00:00.000Z.",
    },
    { type: "null" },
  ],
} as const;
const russianString = (maximum: number) => ({
  type: "string",
  minLength: 1,
  maxLength: maximum,
  pattern: russianTextPattern,
});
const confidence = { type: "number", minimum: 0, maximum: 1 };
const source = (fragmentDescription: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["pageNumber", "fragment"],
  properties: {
    pageNumber: { type: "integer", minimum: 1, maximum: limits.pages },
    fragment: {
      type: "string",
      minLength: 12,
      maxLength: limits.fragmentCharacters,
      description: fragmentDescription,
    },
  },
});

const classificationProperties = {
  category: { type: "string", enum: DOCUMENT_CATEGORIES },
  title: russianString(200),
  shortSummary: russianString(500),
  detailedSummary: russianString(4000),
  documentDate: nullableDate,
  sampledAt: nullableTimestamp,
  resultedAt: nullableTimestamp,
  specimenType: nullableString(200),
  laboratory: nullableString(200),
  confidence,
};
/** Every field is required and nothing else is allowed; the parsers check the same list. */
export const classificationFields = Object.keys(classificationProperties);
const classification = {
  type: "object",
  additionalProperties: false,
  required: classificationFields,
  properties: classificationProperties,
};

const structuredResultProperties = {
  resultKey: { type: "string", pattern: keyPattern, maxLength: limits.keyCharacters },
  type: { type: "string", enum: DOCUMENT_INTELLIGENCE_STRUCTURED_RESULT_TYPES },
  label: russianString(200),
  value: nullableString(500),
  unit: nullableString(100),
  code: nullableString(100),
  lab: nullableString(200),
  specimen: nullableString(200),
  date: nullableDate,
  status: {
    type: "string",
    enum: DOCUMENT_INTELLIGENCE_RESULT_STATUSES,
    description:
      "Use above_range only for an explicit high flag or a printed value above the printed source range; otherwise never infer it.",
  },
  confidence,
  source: source(
    "Exact complete source line or contiguous lines copied from the page for this result.",
  ),
};
export const structuredResultFields = Object.keys(structuredResultProperties);
const structuredResults = {
  type: "array",
  maxItems: limits.structuredResults,
  items: {
    type: "object",
    additionalProperties: false,
    required: structuredResultFields,
    properties: structuredResultProperties,
  },
};

const referenceRangeProperties = {
  sourceText: nullableString(200),
  sourceLow: nullableString(100),
  sourceHigh: nullableString(100),
  sourceUnit: nullableString(100),
  laboratoryOutOfRange: { anyOf: [{ type: "boolean" }, { type: "null" }] },
};
export const referenceRangeFields = Object.keys(referenceRangeProperties);
const factProperties = {
  factKey: { type: "string", pattern: keyPattern, maxLength: limits.keyCharacters },
  sourceName: { type: "string", minLength: 1, maxLength: 200 },
  sourceValue: { type: "string", minLength: 1, maxLength: 100 },
  sourceUnit: { type: "string", minLength: 1, maxLength: 100 },
  proposedCanonicalCode: nullableString(100),
  proposedNormalizedValue: nullableString(100),
  proposedNormalizedUnit: nullableString(100),
  proposedSampledAt: nullableTimestamp,
  proposedResultedAt: nullableTimestamp,
  proposedSpecimenType: nullableString(200),
  proposedLaboratory: nullableString(200),
  referenceRange: {
    anyOf: [
      {
        type: "object",
        additionalProperties: false,
        required: referenceRangeFields,
        properties: referenceRangeProperties,
      },
      { type: "null" },
    ],
  },
  confidence,
  validationIssues: {
    type: "array",
    maxItems: LAB_FACT_VALIDATION_ISSUES.length,
    items: { type: "string", enum: LAB_FACT_VALIDATION_ISSUES },
  },
  source: source(
    "Exact complete source line or contiguous lines copied from the page, including the measurement name, value, and unit; never only a value.",
  ),
};
export const factFields = Object.keys(factProperties);
const facts = {
  type: "array",
  maxItems: limits.facts,
  items: {
    type: "object",
    additionalProperties: false,
    required: factFields,
    properties: factProperties,
  },
};

const pageProperties = {
  pageNumber: { type: "integer", minimum: 1, maximum: limits.pages },
  text: {
    type: "string",
    minLength: 1,
    maxLength: limits.pageTextCharacters,
    description:
      "Faithful transcription of every printed line on this page image, one line per printed line, in reading order. Never summarize, translate, or correct.",
  },
};
export const transcribedPageFields = Object.keys(pageProperties);
const pages = {
  type: "array",
  minItems: 1,
  maxItems: limits.pages,
  items: {
    type: "object",
    additionalProperties: false,
    required: transcribedPageFields,
    properties: pageProperties,
  },
};

const codeDescription =
  "One of the household's known analyte codes when this measurement is that analyte, otherwise null. Never invent a code.";

/**
 * The schema for one run. With a catalog, proposedCanonicalCode is an enum of its codes plus
 * null, so the model cannot invent a code at all; without one the field stays a bounded string.
 */
export function answerSchemaFor(
  transport: "text" | "vision",
  catalog: readonly AnalyteCatalogEntry[],
) {
  const proposedCanonicalCode =
    catalog.length === 0
      ? facts.items.properties.proposedCanonicalCode
      : { enum: [...catalog.map((entry) => entry.code), null], description: codeDescription };
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: [
      ...(transport === "vision" ? ["pages"] : []),
      "classification",
      "structuredResults",
      "facts",
    ],
    properties: {
      ...(transport === "vision" ? { pages } : {}),
      classification,
      structuredResults,
      facts: {
        ...facts,
        items: {
          ...facts.items,
          properties: { ...facts.items.properties, proposedCanonicalCode },
        },
      },
    },
  };
}
