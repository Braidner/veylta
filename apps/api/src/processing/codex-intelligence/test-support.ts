import { readFile } from "node:fs/promises";
import {
  createCodexDocumentIntelligenceProvider,
  type DocumentIntelligenceExecutor,
} from "../codex-document-intelligence-provider.js";

// Fixtures shared by the codex-intelligence test files: a synthetic page, an executor that
// answers with a fixed payload and records what it was asked, and small builders for a
// laboratory answer, its measurements and its facts.

export const pages = [
  {
    pageNumber: 1,
    text: [
      "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
      "Report date: 2026-08-12",
      "Synthetic glucose: 7.0 synthetic-unit",
      "Reference: < 6.0 synthetic-unit",
    ].join("\n"),
    extractionMethod: "pdf_text_layer",
    extractionVersion: "pdfjs-dist/6.2.108",
  },
] as const;

export function executorFor(
  output: unknown,
  calls: Array<{ arguments: readonly string[]; input: string; outputSchema: string }>,
) {
  const executor: DocumentIntelligenceExecutor = async (arguments_, input, files) => {
    calls.push({
      arguments: arguments_,
      input,
      outputSchema: await readFile(files.schemaPath, "utf8"),
    });
    await files.writeOutput(JSON.stringify(output));
    return { stdout: "", stderr: "", runtimeVersion: "codex-cli 0.147.0" };
  };
  return executor;
}

export const twoLinePages = [
  {
    pageNumber: 1,
    text: [
      "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
      "Synthetic glucose: 7.0 synthetic-unit",
      "Synthetic lactate: 2.0 synthetic-unit",
    ].join("\n"),
    extractionMethod: "pdf_text_layer",
    extractionVersion: "pdfjs-dist/6.2.108",
  },
] as const;

export function laboratoryAnswer(overrides: {
  structuredResults?: readonly unknown[];
  facts: readonly unknown[];
}) {
  return {
    classification: {
      category: "laboratory",
      title: "Синтетический лабораторный отчёт",
      shortSummary: "В документе указаны синтетические результаты.",
      detailedSummary: "Документ содержит синтетические измерения без интерпретации.",
      documentDate: null,
      sampledAt: null,
      resultedAt: null,
      specimenType: null,
      laboratory: null,
      confidence: 0.96,
    },
    structuredResults: overrides.structuredResults ?? [],
    facts: overrides.facts,
  };
}

export function measurementResult(
  resultKey: string,
  label: string,
  value: string,
  fragment: string,
) {
  return {
    resultKey,
    type: "measurement",
    label,
    value,
    unit: "synthetic-unit",
    code: null,
    lab: null,
    specimen: null,
    date: null,
    status: "unknown",
    confidence: 0.9,
    source: { pageNumber: 1, fragment },
  };
}

export function measurementFact(
  factKey: string,
  sourceName: string,
  value: string,
  fragment: string,
) {
  return {
    factKey,
    sourceName,
    sourceValue: value,
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
    source: { pageNumber: 1, fragment },
  };
}

export function lowEffortProvider(answer: unknown) {
  return createCodexDocumentIntelligenceProvider(
    {
      resolveExecutionProfile: async () => ({
        modelId: "gpt-5.4-mini",
        documentModelId: null,
        reasoningEffort: "low",
        documentReasoningEffort: "low",
        assistantReasoningEffort: "high",
        serviceTier: "standard",
      }),
      timeoutMs: 120_000,
    },
    executorFor(answer, []),
  );
}
