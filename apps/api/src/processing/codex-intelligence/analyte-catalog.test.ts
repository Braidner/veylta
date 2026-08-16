import assert from "node:assert/strict";
import test from "node:test";
import { createCodexDocumentIntelligenceProvider } from "../codex-document-intelligence-provider.js";
import { executorFor, pages } from "./test-support.js";

/**
 * The household's confirmed analyte catalog travels with every request, so the model links a
 * measurement to a code the family already uses instead of inventing one. The schema pins
 * proposedCanonicalCode to that catalog; a code that still slips through is dropped from the
 * fact server-side while the measurement itself is kept.
 */
test("the analyte catalog is sent to Codex and bounds proposedCanonicalCode", async () => {
  const calls: Array<{ arguments: readonly string[]; input: string; outputSchema: string }> = [];
  const catalog = [
    {
      code: "bilirubin.total",
      displayName: "Билирубин общий",
      unit: "µmol/L",
      aliases: ["билирубин общий"],
    },
    {
      code: "synthetic-analyte-a",
      displayName: "Синтетический аналит A",
      unit: "synthetic-unit",
      aliases: [],
    },
  ];
  const provider = createCodexDocumentIntelligenceProvider(
    {
      resolveExecutionProfile: async () => ({
        modelId: "gpt-5.4-mini",
        documentModelId: null,
        reasoningEffort: "medium",
        documentReasoningEffort: "medium",
        serviceTier: "standard",
      }),
      timeoutMs: 120_000,
    },
    executorFor(
      {
        classification: {
          category: "laboratory",
          title: "Синтетический лабораторный отчёт",
          shortSummary: "Один синтетический результат.",
          detailedSummary: "Документ содержит одно синтетическое измерение.",
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
            factKey: "synthetic-glucose",
            sourceName: "Synthetic glucose",
            sourceValue: "7.0",
            sourceUnit: "synthetic-unit",
            proposedCanonicalCode: "made-up.code",
            proposedNormalizedValue: null,
            proposedNormalizedUnit: null,
            proposedSampledAt: null,
            proposedResultedAt: null,
            proposedSpecimenType: null,
            proposedLaboratory: null,
            referenceRange: null,
            confidence: 0.9,
            validationIssues: [],
            source: { pageNumber: 1, fragment: "Synthetic glucose: 7.0 synthetic-unit" },
          },
        ],
      },
      calls,
    ),
  );

  // A code outside the catalog cannot be a link; the measurement itself is kept for review.
  const output = await provider.analyze({
    contentType: "application/pdf",
    pages,
    analyteCatalog: catalog,
  });
  assert.equal(output.extraction.items.length, 1);
  assert.equal(output.extraction.items[0]?.proposedCanonicalCode, null);
  const call = calls[0];
  assert.ok(call !== undefined);
  assert.match(call.input, /bilirubin\.total/);
  assert.match(call.input, /Билирубин общий/);
  const schema = JSON.parse(call.outputSchema) as {
    properties: {
      facts: { items: { properties: { proposedCanonicalCode: { enum?: unknown[] } } } };
    };
  };
  assert.deepEqual(schema.properties.facts.items.properties.proposedCanonicalCode.enum, [
    "bilirubin.total",
    "synthetic-analyte-a",
    null,
  ]);
});
