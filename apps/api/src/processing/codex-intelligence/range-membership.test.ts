import assert from "node:assert/strict";
import test from "node:test";
import { createCodexDocumentIntelligenceProvider } from "../codex-document-intelligence-provider.js";
import { executorFor, pages } from "./test-support.js";

test("an above_range claim the source does not support is downgraded, not accepted", async () => {
  const withinRangePages = [
    {
      ...pages[0],
      text: [
        "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
        "Synthetic glucose: 5.0 synthetic-unit",
        "Reference: < 6.0 synthetic-unit",
      ].join("\n"),
    },
  ];
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
          shortSummary: "В документе указано одно синтетическое лабораторное значение.",
          detailedSummary: "Значение находится внутри явно напечатанного диапазона источника.",
          documentDate: null,
          sampledAt: null,
          resultedAt: null,
          specimenType: null,
          laboratory: null,
          confidence: 0.95,
        },
        structuredResults: [
          {
            resultKey: "synthetic-glucose",
            type: "measurement",
            label: "Синтетическая глюкоза",
            value: "5.0",
            unit: "synthetic-unit",
            code: null,
            lab: null,
            specimen: null,
            date: null,
            status: "above_range",
            confidence: 0.95,
            source: {
              pageNumber: 1,
              fragment: [
                "Synthetic glucose: 5.0 synthetic-unit",
                "Reference: < 6.0 synthetic-unit",
              ].join("\n"),
            },
          },
        ],
        facts: [
          {
            factKey: "synthetic-glucose",
            sourceName: "Synthetic glucose",
            sourceValue: "5.0",
            sourceUnit: "synthetic-unit",
            proposedCanonicalCode: null,
            proposedNormalizedValue: null,
            proposedNormalizedUnit: null,
            proposedSampledAt: null,
            proposedResultedAt: null,
            proposedSpecimenType: null,
            proposedLaboratory: null,
            referenceRange: {
              sourceText: "< 6.0 synthetic-unit",
              sourceLow: null,
              sourceHigh: "6.0",
              sourceUnit: "synthetic-unit",
              laboratoryOutOfRange: null,
            },
            confidence: 0.95,
            validationIssues: [],
            source: { pageNumber: 1, fragment: "Synthetic glucose: 5.0 synthetic-unit" },
          },
        ],
      },
      [],
    ),
  );

  const output = await provider.analyze({
    contentType: "application/pdf",
    pages: withinRangePages,
  });
  // The run is accepted; only the unsupported status is dropped.
  assert.equal(output.intelligence.structuredResults.length, 1);
  assert.equal(output.intelligence.structuredResults[0]?.status, "unknown");
});

test("range membership is computed from transcribed bounds, not from the fragment text", async () => {
  const analyzeWith = async (
    referenceRange: Record<string, unknown>,
    status: string,
  ): Promise<{ status: string }> => {
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
            shortSummary: "В документе указан один синтетический результат.",
            detailedSummary: "Документ содержит синтетическое измерение и исходный диапазон.",
            documentDate: null,
            sampledAt: null,
            resultedAt: null,
            specimenType: null,
            laboratory: null,
            confidence: 0.9,
          },
          structuredResults: [
            {
              resultKey: "synthetic-glucose",
              type: "measurement",
              label: "Синтетическая глюкоза",
              value: "7.0",
              unit: "synthetic-unit",
              code: null,
              lab: null,
              specimen: null,
              date: null,
              status,
              confidence: 0.9,
              source: { pageNumber: 1, fragment: "Synthetic glucose: 7.0 synthetic-unit" },
            },
          ],
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
              proposedResultedAt: null,
              proposedSpecimenType: null,
              proposedLaboratory: null,
              referenceRange,
              confidence: 0.9,
              validationIssues: [],
              source: { pageNumber: 1, fragment: "Synthetic glucose: 7.0 synthetic-unit" },
            },
          ],
        },
        [],
      ),
    );
    const output = await provider.analyze({ contentType: "application/pdf", pages });
    const result = output.intelligence.structuredResults[0];
    if (result === undefined) throw new Error("Expected one structured result");
    return { status: result.status };
  };

  // The fragment prints no parsable range, but the transcribed upper bound settles it.
  assert.deepEqual(
    await analyzeWith(
      {
        sourceText: "Референс 2,1 … 6,0",
        sourceLow: "2.1",
        sourceHigh: "6.0",
        sourceUnit: "synthetic-unit",
        laboratoryOutOfRange: null,
      },
      "unknown",
    ),
    { status: "above_range" },
  );

  // Inside the transcribed bounds: an above_range claim is downgraded, never accepted.
  assert.deepEqual(
    await analyzeWith(
      {
        sourceText: "Референс 2,1 … 9,0",
        sourceLow: "2.1",
        sourceHigh: "9.0",
        sourceUnit: "synthetic-unit",
        laboratoryOutOfRange: null,
      },
      "above_range",
    ),
    { status: "unknown" },
  );

  // Nothing to compare against: the claim is dropped instead of failing the whole run.
  assert.deepEqual(
    await analyzeWith(
      {
        sourceText: "Референс не указан",
        sourceLow: null,
        sourceHigh: null,
        sourceUnit: null,
        laboratoryOutOfRange: null,
      },
      "above_range",
    ),
    { status: "unknown" },
  );

  // The laboratory's own flag is authority enough.
  assert.deepEqual(
    await analyzeWith(
      {
        sourceText: "Референс не указан",
        sourceLow: null,
        sourceHigh: null,
        sourceUnit: null,
        laboratoryOutOfRange: true,
      },
      "unknown",
    ),
    { status: "above_range" },
  );
});
