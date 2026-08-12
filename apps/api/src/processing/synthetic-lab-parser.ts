import { createHash } from "node:crypto";
import { LAB_EXTRACTION_SCHEMA_VERSION, SYNTHETIC_INDICATOR_CATALOG } from "@veylta/contracts";

export const SYNTHETIC_LAB_PARSER_VERSION = "synthetic-lab-text/v1" as const;
export const SYNTHETIC_LAB_FIXTURE_HEADER = "VEYLTA SYNTHETIC LAB REPORT v1" as const;
export const SYNTHETIC_LAB_FIXTURE_DISCLAIMER =
  "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE" as const;

const maxPageCount = 50;
const maxPageTextCharacters = 250_000;
const maxTotalTextCharacters = 1_000_000;
const maxFactCount = 100;
const reviewConfidenceThreshold = 0.85;
const factKeyPattern = /^synthetic-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const versionPattern = /^[a-z0-9][a-z0-9._/-]{0,99}$/;
const syntheticIndicatorCodes: ReadonlySet<string> = new Set(
  SYNTHETIC_INDICATOR_CATALOG.map((indicator) => indicator.canonicalCode),
);
const allowedFixtureIssues = new Set<ValidationIssue>([
  "LOW_CONFIDENCE",
  "AMBIGUOUS_UNIT",
  "MISSING_UNIT",
  "INVALID_VALUE",
  "INVALID_DATE",
  "INVALID_REFERENCE_RANGE",
  "UNSUPPORTED_ANALYTE",
]);

export type ValidationIssue =
  | "LOW_CONFIDENCE"
  | "AMBIGUOUS_UNIT"
  | "MISSING_UNIT"
  | "INVALID_VALUE"
  | "INVALID_DATE"
  | "INVALID_REFERENCE_RANGE"
  | "UNSUPPORTED_ANALYTE";
export type ExtractedFactReviewStatus = "extracted" | "needs_review";
export type SyntheticLabParseErrorCode =
  | "INVALID_EXTRACTION_OUTPUT"
  | "UNSUPPORTED_SYNTHETIC_FORMAT";

export interface ExtractedPageText {
  pageNumber: number;
  text: string;
  extractionMethod: string;
  extractionVersion: string;
}

export interface ParsedDocumentPage extends ExtractedPageText {
  textSha256: string;
}

export interface StrictLabExtractionFact {
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
  readonly referenceRange: {
    readonly sourceText: string | null;
    readonly sourceLow: string | null;
    readonly sourceHigh: string | null;
    readonly sourceUnit: string | null;
    readonly laboratoryOutOfRange: boolean | null;
  } | null;
  readonly confidence: number;
  readonly validationIssues: readonly ValidationIssue[];
  readonly source: { readonly pageNumber: number; readonly fragment: string };
}

export interface StrictLabExtractionResult {
  readonly schemaVersion: typeof LAB_EXTRACTION_SCHEMA_VERSION;
  readonly extractorVersion: typeof SYNTHETIC_LAB_PARSER_VERSION;
  readonly items: readonly StrictLabExtractionFact[];
}

export interface ParsedLabExtraction {
  pages: ParsedDocumentPage[];
  extraction: StrictLabExtractionResult;
}

export class SyntheticLabParseError extends Error {
  constructor(readonly code: SyntheticLabParseErrorCode) {
    super(
      code === "UNSUPPORTED_SYNTHETIC_FORMAT"
        ? "Unsupported synthetic format"
        : "Invalid extraction output",
    );
    this.name = "SyntheticLabParseError";
  }
}

export function requireSyntheticLabFixture(pages: readonly ExtractedPageText[]): void {
  const firstLines = pages[0]?.text.replaceAll("\r\n", "\n").split("\n");
  if (
    firstLines?.[0] !== SYNTHETIC_LAB_FIXTURE_HEADER ||
    firstLines[1] !== SYNTHETIC_LAB_FIXTURE_DISCLAIMER
  ) {
    throw new SyntheticLabParseError("UNSUPPORTED_SYNTHETIC_FORMAT");
  }
}

function invalidOutput(): never {
  throw new SyntheticLabParseError("INVALID_EXTRACTION_OUTPUT");
}

function boundedField(value: string, maxLength: number): string {
  if (
    value.length === 0 ||
    value.length > maxLength ||
    value !== value.trim() ||
    value.includes("|")
  ) {
    invalidOutput();
  }
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    })
  ) {
    invalidOutput();
  }
  return value;
}

function parseConfidence(value: string): number {
  if (!/^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/.test(value)) invalidOutput();
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) invalidOutput();
  return parsed;
}

function parseIssues(value: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (value !== "NONE") {
    const candidates = value.split(",");
    if (candidates.length === 0 || new Set(candidates).size !== candidates.length) invalidOutput();
    for (const candidate of candidates) {
      if (!allowedFixtureIssues.has(candidate as ValidationIssue)) invalidOutput();
      issues.push(candidate as ValidationIssue);
    }
  }
  return issues;
}

function assertPage(page: ExtractedPageText, seenPageNumbers: Set<number>): void {
  if (
    !Number.isSafeInteger(page.pageNumber) ||
    page.pageNumber < 1 ||
    seenPageNumbers.has(page.pageNumber) ||
    typeof page.text !== "string" ||
    page.text.length > maxPageTextCharacters ||
    !versionPattern.test(page.extractionMethod) ||
    !versionPattern.test(page.extractionVersion)
  ) {
    invalidOutput();
  }
  seenPageNumbers.add(page.pageNumber);
}

const factFieldPrefixes = [
  "FACT|",
  "NAME|",
  "VALUE|",
  "UNIT|",
  "RANGE|",
  "CONFIDENCE|",
  "ISSUES|",
] as const;

function factField(block: readonly string[], index: number): string {
  const line = block[index];
  const prefix = factFieldPrefixes[index];
  if (line === undefined || prefix === undefined || !line.startsWith(prefix)) invalidOutput();
  return line.slice(prefix.length);
}

function parseFact(block: readonly string[], pageNumber: number): StrictLabExtractionFact {
  if (block.length !== 8 || block[7] !== "END") invalidOutput();
  const factKey = factField(block, 0);
  const sourceName = factField(block, 1);
  const sourceValue = factField(block, 2);
  const sourceUnit = factField(block, 3);
  const referenceText = factField(block, 4);
  const confidenceText = factField(block, 5);
  const issueText = factField(block, 6);
  if (factKey.length > 100 || !factKeyPattern.test(factKey)) invalidOutput();

  const confidence = parseConfidence(confidenceText);
  const validationIssues = parseIssues(issueText);
  return {
    factKey,
    sourceName: boundedField(sourceName, 200),
    sourceValue: boundedField(sourceValue, 100),
    sourceUnit: boundedField(sourceUnit, 100),
    proposedCanonicalCode: syntheticIndicatorCodes.has(factKey) ? factKey : null,
    proposedNormalizedValue: null,
    proposedNormalizedUnit: null,
    referenceRange: {
      sourceText: boundedField(referenceText, 200),
      sourceLow: null,
      sourceHigh: null,
      sourceUnit: boundedField(sourceUnit, 100),
      laboratoryOutOfRange: null,
    },
    proposedSpecimenType: null,
    proposedSampledAt: null,
    proposedResultedAt: null,
    proposedLaboratory: null,
    confidence,
    validationIssues,
    source: { pageNumber, fragment: block.join("\n") },
  };
}

export function reviewStatusForFact(fact: StrictLabExtractionFact): ExtractedFactReviewStatus {
  return fact.confidence < reviewConfidenceThreshold || fact.validationIssues.length > 0
    ? "needs_review"
    : "extracted";
}

export function parseSyntheticLabPages(pages: readonly ExtractedPageText[]): ParsedLabExtraction {
  if (pages.length === 0 || pages.length > maxPageCount) invalidOutput();

  const sortedPages = [...pages].sort((left, right) => left.pageNumber - right.pageNumber);
  const seenPageNumbers = new Set<number>();
  let totalTextCharacters = 0;
  for (const page of sortedPages) {
    assertPage(page, seenPageNumbers);
    totalTextCharacters += page.text.length;
    if (totalTextCharacters > maxTotalTextCharacters) invalidOutput();
  }

  requireSyntheticLabFixture(sortedPages);

  const facts: StrictLabExtractionFact[] = [];
  const seenFactKeys = new Set<string>();
  for (const page of sortedPages) {
    let lines = page.text.replaceAll("\r\n", "\n").split("\n");
    if (page.pageNumber === sortedPages[0]?.pageNumber) lines = lines.slice(2);
    for (let index = 0; index < lines.length; index += 8) {
      const block = lines.slice(index, index + 8);
      const fact = parseFact(block, page.pageNumber);
      if (seenFactKeys.has(fact.factKey) || facts.length >= maxFactCount) invalidOutput();
      seenFactKeys.add(fact.factKey);
      facts.push(fact);
    }
  }
  if (facts.length === 0) invalidOutput();

  return {
    pages: sortedPages.map((page) => ({
      ...page,
      textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
    })),
    extraction: {
      schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
      extractorVersion: SYNTHETIC_LAB_PARSER_VERSION,
      items: facts,
    },
  };
}
