import { createHash } from "node:crypto";
import {
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  LAB_EXTRACTION_SCHEMA_VERSION,
} from "@veylta/contracts";
import { CODEX_DOCUMENT_INTELLIGENCE_VERSION } from "../src/processing/codex-document-intelligence-provider.js";
import type { DocumentIntelligenceProvider } from "../src/processing/document-intelligence-provider.js";
import { parseSyntheticLabPages } from "../src/processing/synthetic-lab-parser.js";

/**
 * A deterministic stand-in for Codex: it transcribes the synthetic grammar already printed
 * on the page, so integration tests exercise the real processing path without a model.
 */
export function createSyntheticIntelligence(): DocumentIntelligenceProvider {
  return {
    async analyze(input) {
      const pages = input.pages.map((page) => ({
        ...page,
        textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
      }));
      let items: ReturnType<typeof parseSyntheticLabPages>["extraction"]["items"] = [];
      try {
        items = parseSyntheticLabPages(input.pages).extraction.items;
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
