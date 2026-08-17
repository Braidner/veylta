import { createHash } from "node:crypto";
import {
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  LAB_EXTRACTION_SCHEMA_VERSION,
} from "@veylta/contracts";
import { CODEX_DOCUMENT_INTELLIGENCE_VERSION } from "../src/processing/codex-document-intelligence-provider.js";
import type { DocumentIntelligenceProvider } from "../src/processing/document-intelligence-provider.js";
import {
  parseSyntheticLabPages,
  SYNTHETIC_LAB_FIXTURE_DISCLAIMER,
  SYNTHETIC_LAB_FIXTURE_HEADER,
} from "../src/processing/synthetic-lab-parser.js";

/**
 * A deterministic stand-in for Codex: it transcribes the synthetic grammar already printed
 * on the page, so integration tests exercise the real processing path without a model.
 */
/**
 * What the double "reads" from any attached page image. A real model transcribes the picture;
 * a test double cannot, so every image source yields this one synthetic line, and tests assert
 * the plumbing around it: page provenance, fact binding, run journal.
 */
export const SYNTHETIC_VISION_TRANSCRIPTION = [
  SYNTHETIC_LAB_FIXTURE_HEADER,
  SYNTHETIC_LAB_FIXTURE_DISCLAIMER,
  "FACT|synthetic-analyte-a",
  "NAME|SYNTHETIC ANALYTE A",
  "VALUE|7.0",
  "UNIT|synthetic-unit",
  "RANGE|synthetic reference",
  "CONFIDENCE|0.60",
  "ISSUES|AMBIGUOUS_UNIT",
  "END",
].join("\n");

type SyntheticItems = ReturnType<typeof parseSyntheticLabPages>["extraction"]["items"];

export function createSyntheticIntelligence(
  options: {
    visionTranscription?: string;
    /** Reshape the extracted facts before storage — to replay a shape an older run wrote. */
    mapItems?: (items: SyntheticItems) => SyntheticItems;
  } = {},
): DocumentIntelligenceProvider {
  const visionTranscription = options.visionTranscription ?? SYNTHETIC_VISION_TRANSCRIPTION;
  return {
    async analyze(input) {
      // Image sources: stand in for the model's own transcription of each attached page.
      const textPages =
        input.images !== undefined && input.images.length > 0
          ? input.images.map((image) => ({
              pageNumber: image.pageNumber,
              text: visionTranscription,
              extractionMethod: "codex_vision",
              extractionVersion: "gpt-5.4-mini+codex-cli/test",
            }))
          : input.pages;
      const pages = textPages.map((page) => ({
        ...page,
        textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
      }));
      let items: SyntheticItems = [];
      try {
        items = parseSyntheticLabPages(textPages).extraction.items;
        items = options.mapItems === undefined ? items : options.mapItems(items);
      } catch {
        // This deterministic double simulates Codex classifying a non-lab document with no facts.
      }
      return {
        pages,
        extraction: {
          schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
          extractorVersion: CODEX_DOCUMENT_INTELLIGENCE_VERSION,
          items,
        },
        intelligence: {
          contractVersion: DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
          provider: "codex",
          modelId: "gpt-5.4-mini",
          runtimeVersion: "codex-cli/test",
          category: items.length > 0 ? "laboratory" : "other",
          title: items.length > 0 ? "Синтетические анализы" : "Синтетический документ",
          shortSummary:
            items.length > 0
              ? "Синтетические лабораторные результаты."
              : "Синтетический документ без лабораторных результатов.",
          detailedSummary:
            items.length > 0
              ? "Источник содержит только синтетические лабораторные данные для тестирования."
              : "Источник содержит только безопасные синтетические данные для тестирования.",
          structuredResults: [],
          documentDate: null,
          confidence: 0.95,
        },
      };
    },
  };
}
