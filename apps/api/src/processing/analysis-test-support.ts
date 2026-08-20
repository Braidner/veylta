import { createHash } from "node:crypto";
import {
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  type DocumentIntelligenceStructuredResult,
  LAB_EXTRACTION_SCHEMA_VERSION,
} from "@veylta/contracts";
import { CODEX_DOCUMENT_INTELLIGENCE_VERSION } from "./codex-document-intelligence-provider.js";
import type { DocumentAnalysis } from "./document-intelligence-provider.js";
import type { ExtractedPdfPage } from "./pdf-text-extractor.js";
import type { ParsedDocumentPage, StrictLabExtractionFact } from "./synthetic-lab-parser.js";

// Fixtures for one verified analysis: the pages a text pass yielded, the facts and results it
// bound to them, and the whole output a provider would have returned. Synthetic content only.

const readText = "СИНТЕТИЧЕСКАЯ СТРОКА ОТЧЁТА СО ЗНАЧЕНИЯМИ\n".repeat(30);
const pictureText = "СИНТЕТИЧЕСКАЯ ЛАБОРАТОРИЯ\nПротеинограмма";

/** A text-layer page as the extractor reports it: read as text, or a picture with a caption. */
export function pdfPage(pageNumber: number, kind: "read" | "picture"): ExtractedPdfPage {
  return {
    pageNumber,
    text: kind === "read" ? readText : pictureText,
    extractionMethod: "pdf_text_layer",
    extractionVersion: "pdfjs-dist/6.2.108",
    hasRasterImage: kind === "picture",
  };
}

export function parsedPage(
  page: ExtractedPdfPage,
  extractionMethod: string,
  text = page.text,
): ParsedDocumentPage {
  return {
    pageNumber: page.pageNumber,
    text,
    extractionMethod,
    extractionVersion:
      extractionMethod === "codex_vision" ? "gpt-5.4-mini+codex-cli/test" : "pdfjs-dist/6.2.108",
    textSha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}

export function fact(
  factKey: string,
  pageNumber: number,
  sourceValue: string,
): StrictLabExtractionFact {
  return {
    factKey,
    sourceName: "СИНТЕТИЧЕСКИЙ АНАЛИТ",
    sourceValue,
    sourceUnit: "synthetic-unit",
    proposedCanonicalCode: null,
    proposedNormalizedValue: null,
    proposedNormalizedUnit: null,
    proposedSampledAt: null,
    proposedResultedAt: null,
    proposedSpecimenType: null,
    proposedLaboratory: null,
    referenceRange: null,
    confidence: 0.9,
    validationIssues: [],
    source: { pageNumber, fragment: `${factKey} ${sourceValue}` },
  };
}

export function measurement(
  resultKey: string,
  pageNumber: number,
  value: string,
): DocumentIntelligenceStructuredResult {
  return {
    resultKey,
    type: "measurement",
    label: "СИНТЕТИЧЕСКИЙ АНАЛИТ",
    value,
    unit: "synthetic-unit",
    code: null,
    lab: null,
    specimen: null,
    date: null,
    status: "unknown",
    confidence: 0.9,
    source: { pageNumber, fragment: `${resultKey} ${value}` },
  };
}

export function analysis(input: {
  pages: readonly ParsedDocumentPage[];
  facts: readonly StrictLabExtractionFact[];
  results?: readonly DocumentIntelligenceStructuredResult[];
  title?: string;
}): DocumentAnalysis {
  return {
    pages: input.pages,
    extraction: {
      schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
      extractorVersion: CODEX_DOCUMENT_INTELLIGENCE_VERSION,
      items: input.facts,
    },
    intelligence: {
      contractVersion: DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
      provider: "codex",
      modelId: "gpt-5.4-mini",
      runtimeVersion: "codex-cli/test",
      category: "laboratory",
      title: input.title ?? "Синтетические анализы",
      shortSummary: "Синтетические лабораторные результаты.",
      detailedSummary: "Источник содержит только синтетические данные.",
      structuredResults: input.results ?? [],
      documentDate: null,
      confidence: 0.9,
    },
  };
}
