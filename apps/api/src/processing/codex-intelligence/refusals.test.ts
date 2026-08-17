import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexDocumentIntelligenceError,
  createCodexDocumentIntelligenceProvider,
} from "../codex-document-intelligence-provider.js";
import { executorFor, pages } from "./test-support.js";

test("Codex output fails closed when a generic result label is not in Russian", async () => {
  const provider = createCodexDocumentIntelligenceProvider(
    {
      resolveExecutionProfile: async () => ({
        modelId: "gpt-5.4-mini",
        documentModelId: null,
        reasoningEffort: "medium",
        documentReasoningEffort: "medium",
        assistantReasoningEffort: "high",
        serviceTier: "standard",
      }),
      timeoutMs: 120_000,
    },
    executorFor(
      {
        classification: {
          category: "other",
          title: "Синтетический документ",
          shortSummary: "Краткое синтетическое описание документа.",
          detailedSummary: "Документ содержит один структурированный синтетический результат.",
          documentDate: null,
          sampledAt: null,
          resultedAt: null,
          specimenType: null,
          laboratory: null,
          confidence: 0.8,
        },
        structuredResults: [
          {
            resultKey: "synthetic-result",
            type: "finding",
            label: "Synthetic finding",
            value: null,
            unit: null,
            code: null,
            lab: null,
            specimen: null,
            date: null,
            status: "unknown",
            confidence: 0.8,
            source: { pageNumber: 1, fragment: pages[0]?.text.split("\n")[0] },
          },
        ],
        facts: [],
      },
      [],
    ),
  );

  await assert.rejects(
    () => provider.analyze({ contentType: "application/pdf", pages }),
    (error: unknown) =>
      error instanceof CodexDocumentIntelligenceError && error.code === "OUTPUT_INVALID",
  );
});

test("a refused Codex answer names the exact rule it broke", async () => {
  const classification = {
    category: "laboratory",
    title: "Синтетический лабораторный отчёт",
    shortSummary: "В документе указан один синтетический лабораторный результат.",
    detailedSummary: "Документ содержит синтетическое измерение и исходный диапазон.",
    documentDate: "2026-08-12",
    sampledAt: "2026-08-11T07:30:00.000Z",
    resultedAt: "2026-08-12T00:00:00.000Z",
    specimenType: "Венозная кровь",
    laboratory: "Синтетическая лаборатория",
    confidence: 0.96,
  };
  const analyze = async (output: unknown): Promise<unknown> => {
    const provider = createCodexDocumentIntelligenceProvider(
      {
        resolveExecutionProfile: async () => ({
          modelId: "gpt-5.4-mini",
          documentModelId: null,
          reasoningEffort: "medium",
          documentReasoningEffort: "medium",
          assistantReasoningEffort: "high",
          serviceTier: "standard",
        }),
        timeoutMs: 120_000,
      },
      executorFor(output, []),
    );
    return provider.analyze({ contentType: "application/pdf", pages }).then(
      () => null,
      (error: unknown) => error,
    );
  };

  const missingKeys = await analyze({ classification });
  assert.ok(missingKeys instanceof CodexDocumentIntelligenceError);
  assert.equal(missingKeys.reason, "schema_shape");

  const latinTitle = await analyze({
    classification: { ...classification, title: "Synthetic laboratory report" },
    structuredResults: [],
    facts: [],
  });
  assert.ok(latinTitle instanceof CodexDocumentIntelligenceError);
  assert.equal(latinTitle.reason, "not_russian");

  const badConfidence = await analyze({
    classification: { ...classification, confidence: 4 },
    structuredResults: [],
    facts: [],
  });
  assert.ok(badConfidence instanceof CodexDocumentIntelligenceError);
  assert.equal(badConfidence.reason, "invalid_number");

  const badDate = await analyze({
    classification: { ...classification, documentDate: "12.08.2026" },
    structuredResults: [],
    facts: [],
  });
  assert.ok(badDate instanceof CodexDocumentIntelligenceError);
  assert.equal(badDate.reason, "invalid_timestamp");
});
