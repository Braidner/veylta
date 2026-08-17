import assert from "node:assert/strict";
import test from "node:test";
import { createCodexDocumentIntelligenceProvider } from "../codex-document-intelligence-provider.js";
import {
  executorFor,
  laboratoryAnswer,
  lowEffortProvider,
  measurementFact,
  pages,
  twoLinePages,
} from "./test-support.js";

/**
 * A proposed normalization Veylta cannot check is a unit conversion on the model's word alone.
 * Only the identity case — the printed number under a canonical spelling of the unit — is
 * verifiable; anything else is dropped while the fact keeps what the source printed.
 */
test("an unverifiable normalized value is dropped while the fact is kept", async () => {
  const glucose = "Synthetic glucose: 7.0 synthetic-unit";
  const lactate = "Synthetic lactate: 2.0 synthetic-unit";
  const output = await lowEffortProvider(
    laboratoryAnswer({
      facts: [
        {
          ...measurementFact("glucose", "Synthetic glucose", "7.0", glucose),
          proposedNormalizedValue: "7.00",
          proposedNormalizedUnit: "synthetic-unit/L",
        },
        {
          ...measurementFact("lactate", "Synthetic lactate", "2.0", lactate),
          proposedNormalizedValue: "2.4",
          proposedNormalizedUnit: "synthetic-unit/L",
        },
      ],
    }),
  ).analyze({ contentType: "application/pdf", pages: twoLinePages });

  assert.deepEqual(
    output.extraction.items.map((fact) => [
      fact.factKey,
      fact.proposedNormalizedValue,
      fact.proposedNormalizedUnit,
    ]),
    [
      ["glucose", "7.00", "synthetic-unit/L"],
      ["lactate", null, null],
    ],
  );

  // Half a proposal — a value with no unit — is no proposal; the measurement itself stands.
  const half = await lowEffortProvider(
    laboratoryAnswer({
      facts: [
        {
          ...measurementFact("half", "Synthetic lactate", "2.0", lactate),
          proposedNormalizedValue: "2.0",
          proposedNormalizedUnit: null,
        },
      ],
    }),
  ).analyze({ contentType: "application/pdf", pages: twoLinePages });
  assert.deepEqual(
    half.extraction.items.map((fact) => [
      fact.factKey,
      fact.proposedNormalizedValue,
      fact.proposedNormalizedUnit,
    ]),
    [["half", null, null]],
  );
});

/**
 * Smaller models tend to repeat the unit inside the value ("7.0 synthetic-unit" next to
 * sourceUnit "synthetic-unit"). The unit is a separate required field, so the repetition is
 * redundant: it is trimmed deterministically, the value stays comparable with the structured
 * result that carries the bare number, and range membership can still be computed.
 */
test("a value that repeats its own unit is trimmed and still binds to its structured result", async () => {
  const analyzeValue = async (sourceValue: string, sourceUnit: string, resultValue: string) => {
    const provider = createCodexDocumentIntelligenceProvider(
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
              resultKey: "res1",
              type: "measurement",
              label: "Синтетическая глюкоза",
              value: resultValue,
              unit: sourceUnit,
              code: null,
              lab: null,
              specimen: null,
              date: null,
              status: "unknown",
              confidence: 0.9,
              source: { pageNumber: 1, fragment: "Synthetic glucose: 7.0 synthetic-unit" },
            },
          ],
          facts: [
            {
              factKey: "res1",
              sourceName: "Synthetic glucose",
              sourceValue,
              sourceUnit,
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
    const fact = output.extraction.items[0];
    const result = output.intelligence.structuredResults[0];
    if (fact === undefined || result === undefined) throw new Error("Expected one bound fact");
    return {
      value: fact.sourceValue,
      unit: fact.sourceUnit,
      resultValue: result.value,
      status: result.status,
    };
  };

  // Unit repeated after a space, and glued on for symbol units: both trimmed, both above range.
  assert.deepEqual(await analyzeValue("7.0 synthetic-unit", "synthetic-unit", "7.0"), {
    value: "7.0",
    unit: "synthetic-unit",
    resultValue: "7.0",
    status: "above_range",
  });
  assert.deepEqual(await analyzeValue("7.0%", "%", "7.0"), {
    value: "7.0",
    unit: "%",
    resultValue: "7.0",
    status: "above_range",
  });
  // The structured result may repeat the unit as well; both sides trim to the same value.
  assert.deepEqual(
    await analyzeValue("7.0 synthetic-unit", "synthetic-unit", "7.0 synthetic-unit"),
    { value: "7.0", unit: "synthetic-unit", resultValue: "7.0", status: "above_range" },
  );
  // A value that merely ends in the unit's letters is not a repetition and stays verbatim.
  assert.deepEqual(await analyzeValue("7.0", "synthetic-unit", "7.0"), {
    value: "7.0",
    unit: "synthetic-unit",
    resultValue: "7.0",
    status: "above_range",
  });
});
