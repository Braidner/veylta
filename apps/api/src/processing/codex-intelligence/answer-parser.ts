import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  LAB_EXTRACTION_SCHEMA_VERSION,
} from "@veylta/contracts";
import { normalizeAnalyteName } from "../analyte-mapping.js";
import type { DocumentPageImage } from "../document-images.js";
import type {
  AnalyteCatalogEntry,
  DocumentIntelligenceV2Output,
} from "../document-intelligence-provider.js";
import type { ParsedDocumentPage, StrictLabExtractionFact } from "../synthetic-lab-parser.js";
import { KeyRegistry, keptItems } from "./answer-items.js";
import { classificationFields } from "./answer-schema.js";
import { CODEX_DOCUMENT_INTELLIGENCE_VERSION, limits } from "./constants.js";
import { transcribedPages } from "./document-pages.js";
import { invalidOutput } from "./errors.js";
import { parseDocumentMetadata, parseFact } from "./fact-parser.js";
import {
  canonicalDate,
  confidence,
  exactKeys,
  object,
  oneOf,
  russianBoundedString,
} from "./field-parsers.js";
import { bindResultsToFacts, requireCompleteFacts } from "./result-binding.js";
import { SourceText } from "./source-text.js";
import { parseStructuredResult } from "./structured-result-parser.js";

export interface AnswerContext {
  /** The document's text layer; empty when the pages travelled as images. */
  readonly textPages: readonly ParsedDocumentPage[];
  /** Attached page images; the answer must then carry their transcription. */
  readonly images: readonly DocumentPageImage[];
  readonly modelId: string;
  readonly runtimeVersion: string;
  /** Catalog codes the schema allowed; null when no catalog travelled. */
  readonly knownCodes: ReadonlySet<string> | null;
  /** The catalog itself, so a slipped name can be recovered from its printed spellings. */
  readonly catalog: readonly AnalyteCatalogEntry[];
}

/**
 * Turns Codex's raw answer into the verified output of one run. Verification is per item:
 * an unbound fact or summary result is dropped, the verified rest is kept, and only an answer
 * whose every item fails — or whose shape, classification or completeness is wrong — is refused.
 */
export class CodexAnswerParser {
  constructor(private readonly context: AnswerContext) {}

  parse(answer: string): DocumentIntelligenceV2Output {
    const root = this.root(answer);
    const pages = this.pages(root);
    const classification = object(root.classification);
    exactKeys(classification, classificationFields);
    const category = oneOf(classification.category, DOCUMENT_CATEGORIES);
    if (
      !Array.isArray(root.structuredResults) ||
      root.structuredResults.length > limits.structuredResults ||
      !Array.isArray(root.facts) ||
      root.facts.length > limits.facts
    ) {
      invalidOutput("schema_shape");
    }
    const sourceText = new SourceText(pages);
    const structuredResults = this.structuredResults(root.structuredResults, sourceText);
    const documentMetadata = parseDocumentMetadata(classification);
    const facts = this.facts(root.facts, sourceText, documentMetadata);
    const linkedStructuredResults = bindResultsToFacts(structuredResults, facts);
    requireCompleteFacts(category, linkedStructuredResults, facts);
    return {
      pages,
      extraction: {
        schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
        extractorVersion: CODEX_DOCUMENT_INTELLIGENCE_VERSION,
        items: facts,
      },
      intelligence: {
        contractVersion: DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
        provider: "codex",
        modelId: this.context.modelId,
        runtimeVersion: this.context.runtimeVersion,
        category,
        title: russianBoundedString(classification.title, 200),
        documentDate: canonicalDate(classification.documentDate),
        confidence: confidence(classification.confidence),
        shortSummary: russianBoundedString(classification.shortSummary, 500),
        detailedSummary: russianBoundedString(classification.detailedSummary, 4_000),
        structuredResults: linkedStructuredResults,
      },
    };
  }

  private root(answer: string): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer);
    } catch {
      invalidOutput("schema_shape");
    }
    const root = object(parsed);
    exactKeys(
      root,
      this.context.images.length > 0
        ? ["pages", "classification", "structuredResults", "facts"]
        : ["classification", "structuredResults", "facts"],
    );
    return root;
  }

  private pages(root: Record<string, unknown>): readonly ParsedDocumentPage[] {
    const { images, modelId, runtimeVersion, textPages } = this.context;
    return images.length > 0
      ? transcribedPages(root.pages, images, modelId, runtimeVersion)
      : textPages;
  }

  private structuredResults(proposals: readonly unknown[], sourceText: SourceText) {
    const keys = new KeyRegistry();
    return keptItems(proposals, (proposal) => {
      const result = parseStructuredResult(proposal, sourceText);
      const resultKey = keys.claim(result.resultKey);
      return resultKey === result.resultKey ? result : { ...result, resultKey };
    });
  }

  private facts(
    proposals: readonly unknown[],
    sourceText: SourceText,
    documentMetadata: ReturnType<typeof parseDocumentMetadata>,
  ): StrictLabExtractionFact[] {
    const keys = new KeyRegistry();
    const seen = new Set<string>();
    return keptItems(proposals, (proposal) => {
      const fact = this.withKnownCode(
        parseFact(proposal, sourceText, documentMetadata, this.context.catalog),
      );
      // The same reading of the same printed row twice is one fact, however it was quoted.
      const reading = [
        fact.source.pageNumber,
        fact.source.fragment,
        fact.sourceValue,
        fact.sourceUnit,
        normalizeAnalyteName(fact.sourceName),
      ].join("\n");
      if (seen.has(reading)) invalidOutput("duplicate_binding");
      seen.add(reading);
      const factKey = keys.claim(fact.factKey);
      return factKey === fact.factKey ? fact : { ...fact, factKey };
    });
  }

  /**
   * The schema pins the code to the catalog; should one slip through, the measurement is still
   * real — keep it and drop only the unknown link, so the reviewer maps it by hand.
   */
  private withKnownCode(fact: StrictLabExtractionFact): StrictLabExtractionFact {
    const { knownCodes } = this.context;
    if (
      knownCodes === null ||
      fact.proposedCanonicalCode === null ||
      knownCodes.has(fact.proposedCanonicalCode)
    ) {
      return fact;
    }
    return {
      ...fact,
      proposedCanonicalCode: null,
      proposedNormalizedValue: null,
      proposedNormalizedUnit: null,
    };
  }
}
