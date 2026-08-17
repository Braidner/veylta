import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexDocumentIntelligenceError,
  createCodexDocumentIntelligenceProvider,
} from "../codex-document-intelligence-provider.js";
import {
  executorFor,
  laboratoryAnswer,
  lowEffortProvider,
  measurementFact,
  measurementResult,
  pages,
  twoLinePages,
} from "./test-support.js";

test("Codex provenance expands an exact context fragment to its complete source line", async () => {
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
          category: "laboratory",
          title: "Синтетический лабораторный отчёт",
          shortSummary: "В документе указан синтетический результат.",
          detailedSummary: "Документ содержит синтетическое измерение без интерпретации.",
          documentDate: "2026-08-12",
          sampledAt: null,
          resultedAt: null,
          specimenType: null,
          laboratory: null,
          confidence: 0.96,
        },
        structuredResults: [],
        facts: [
          {
            factKey: "synthetic-glucose",
            sourceName: "Synthetic glucose",
            sourceValue: "7.0",
            sourceUnit: "synthetic-unit",
            proposedCanonicalCode: null,
            proposedNormalizedValue: null,
            proposedNormalizedUnit: null,
            proposedSampledAt: null,
            proposedResultedAt: "2026-08-12T00:00:00.000Z",
            proposedSpecimenType: null,
            proposedLaboratory: null,
            referenceRange: null,
            confidence: 0.91,
            validationIssues: [],
            source: {
              pageNumber: 1,
              fragment: "glucose: 7.0 synthetic-unit",
            },
          },
        ],
      },
      [],
    ),
  );

  const result = await provider.analyze({ contentType: "application/pdf", pages });

  assert.equal(
    result.extraction.items[0]?.source.fragment,
    "Synthetic glucose: 7.0 synthetic-unit",
  );
});

/**
 * A fragment stitched from printed but non-adjacent lines — a table header above a row, say —
 * still names its source line: the one line among them that carries the value and occurs
 * exactly once on the page. A composite that leaves the value line ambiguous is refused.
 */
test("a fragment stitched from non-adjacent lines resolves to the single line carrying the value", async () => {
  const header = "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE";
  const lactate = "Synthetic lactate: 2.0 synthetic-unit";
  const stitched = await lowEffortProvider(
    laboratoryAnswer({
      structuredResults: [
        measurementResult("lactate", "Синтетический лактат", "2.0", `${header}\n${lactate}`),
      ],
      facts: [measurementFact("lactate", "Synthetic lactate", "2.0", `${header}\n${lactate}`)],
    }),
  ).analyze({ contentType: "application/pdf", pages: twoLinePages });
  assert.equal(stitched.extraction.items[0]?.source.fragment, lactate);
  assert.equal(stitched.intelligence.structuredResults[0]?.source.fragment, lactate);
  assert.equal(stitched.intelligence.structuredResults[0]?.resultKey, "lactate");

  await assert.rejects(
    () =>
      lowEffortProvider(
        laboratoryAnswer({
          facts: [
            measurementFact("value", "Synthetic value", "7", `${header}\n${lactate}\n${lactate}`),
          ],
        }),
      ).analyze({ contentType: "application/pdf", pages: twoLinePages }),
    (error: unknown) =>
      error instanceof CodexDocumentIntelligenceError && error.reason === "fragment_not_on_page",
  );
});

test("Codex output fails closed when provenance is not an exact page fragment", async () => {
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
          category: "laboratory",
          title: "Синтетический отчёт",
          shortSummary: "В документе указан синтетический результат.",
          detailedSummary: "Документ содержит неподтверждённое синтетическое измерение.",
          documentDate: null,
          sampledAt: null,
          resultedAt: null,
          specimenType: null,
          laboratory: null,
          confidence: 0.9,
        },
        structuredResults: [],
        facts: [
          {
            factKey: "invented",
            sourceName: "Invented",
            sourceValue: "42",
            sourceUnit: "unit",
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
            source: { pageNumber: 1, fragment: "This text is not in the source" },
          },
        ],
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

test("Codex output fails closed when a generic result is not bound to an exact source line", async () => {
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
            resultKey: "invented-result",
            type: "finding",
            label: "Синтетическая находка",
            value: null,
            unit: null,
            code: null,
            lab: null,
            specimen: null,
            date: null,
            status: "unknown",
            confidence: 0.8,
            source: { pageNumber: 1, fragment: "This source line does not exist" },
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
      error instanceof CodexDocumentIntelligenceError &&
      error.code === "OUTPUT_INVALID" &&
      error.reason === "fragment_not_on_page",
  );
});
