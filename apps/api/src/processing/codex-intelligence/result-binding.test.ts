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

test("Codex output fails closed when a shared result key contradicts the review fact", async () => {
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
          shortSummary: "В документе указан один синтетический лабораторный результат.",
          detailedSummary:
            "Документ содержит синтетическое измерение глюкозы и исходный лабораторный диапазон.",
          documentDate: "2026-08-12",
          sampledAt: null,
          resultedAt: null,
          specimenType: null,
          laboratory: null,
          confidence: 0.96,
        },
        structuredResults: [
          {
            resultKey: "synthetic-glucose",
            type: "measurement",
            label: "Синтетическая глюкоза",
            value: "7.1",
            unit: "synthetic-unit",
            code: null,
            lab: null,
            specimen: null,
            date: null,
            status: "unknown",
            confidence: 0.91,
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
            referenceRange: null,
            confidence: 0.91,
            validationIssues: [],
            source: { pageNumber: 1, fragment: "Synthetic glucose: 7.0 synthetic-unit" },
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

/**
 * Keys only bind results to facts inside one answer and seed stable fact IDs. A model that
 * reuses a key for two different lines made a bookkeeping slip, not a provenance error: the
 * second measurement is kept under a derived key rather than dropped or failing the run.
 */
test("a repeated key keeps both measurements instead of losing one or failing the run", async () => {
  const glucose = "Synthetic glucose: 7.0 synthetic-unit";
  const lactate = "Synthetic lactate: 2.0 synthetic-unit";
  const output = await lowEffortProvider(
    laboratoryAnswer({
      structuredResults: [
        measurementResult("synthetic", "Синтетическая глюкоза", "7.0", glucose),
        measurementResult("synthetic", "Синтетический лактат", "2.0", lactate),
      ],
      facts: [
        measurementFact("synthetic", "Synthetic glucose", "7.0", glucose),
        measurementFact("synthetic", "Synthetic lactate", "2.0", lactate),
      ],
    }),
  ).analyze({ contentType: "application/pdf", pages: twoLinePages });

  assert.deepEqual(
    output.extraction.items.map((fact) => [fact.factKey, fact.sourceValue]),
    [
      ["synthetic", "7.0"],
      ["synthetic-2", "2.0"],
    ],
  );
  assert.deepEqual(
    output.intelligence.structuredResults.map((result) => [result.resultKey, result.value]),
    [
      ["synthetic", "7.0"],
      ["synthetic-2", "2.0"],
    ],
  );

  // A result filed under another fact's key still binds by content: value, unit and line agree
  // with exactly one fact, so it takes that fact's key rather than failing the run.
  const misfiled = await lowEffortProvider(
    laboratoryAnswer({
      structuredResults: [
        measurementResult("lactate", "Синтетическая глюкоза", "7.0", glucose),
        measurementResult("lactate", "Синтетический лактат", "2.0", lactate),
      ],
      facts: [
        measurementFact("glucose", "Synthetic glucose", "7.0", glucose),
        measurementFact("lactate", "Synthetic lactate", "2.0", lactate),
      ],
    }),
  ).analyze({ contentType: "application/pdf", pages: twoLinePages });
  assert.deepEqual(
    misfiled.intelligence.structuredResults.map((result) => result.resultKey),
    ["glucose", "lactate"],
  );
});

/**
 * Keys are numbered independently in the two lists by some models, so a result's key naming a
 * fact that reads a different line is misalignment, not a contradiction: the result stays
 * unbound under a key of its own. Two readings of the same line that disagree still fail.
 */
test("a result whose key names an unrelated fact stays unbound instead of failing the run", async () => {
  const glucose = "Synthetic glucose: 7.0 synthetic-unit";
  const lactate = "Synthetic lactate: 2.0 synthetic-unit";
  const output = await lowEffortProvider(
    laboratoryAnswer({
      structuredResults: [measurementResult("glucose", "Синтетический лактат", "2.0", lactate)],
      facts: [measurementFact("glucose", "Synthetic glucose", "7.0", glucose)],
    }),
  ).analyze({ contentType: "application/pdf", pages: twoLinePages });

  assert.deepEqual(
    output.intelligence.structuredResults.map((result) => [result.resultKey, result.value]),
    [["glucose-2", "2.0"]],
  );
  assert.deepEqual(
    output.extraction.items.map((fact) => [fact.factKey, fact.sourceValue]),
    [["glucose", "7.0"]],
  );
});

/**
 * A summary line that prints the number without a unit is the same measurement as the fact on
 * that line; only a different number is a contradiction.
 */
test("a summary result without a unit still binds to the fact on the same line", async () => {
  const glucose = "Synthetic glucose: 7.0 synthetic-unit";
  const output = await lowEffortProvider(
    laboratoryAnswer({
      structuredResults: [
        { ...measurementResult("glucose", "Синтетическая глюкоза", "7.0", glucose), unit: null },
      ],
      facts: [measurementFact("glucose", "Synthetic glucose", "7.0", glucose)],
    }),
  ).analyze({ contentType: "application/pdf", pages: twoLinePages });
  assert.equal(output.intelligence.structuredResults[0]?.resultKey, "glucose");
  assert.equal(output.extraction.items.length, 1);
});

/**
 * With the catalog in the prompt a model tends to write the summary unit in the catalog's
 * Latin spelling while the fact keeps the printed Cyrillic one, and may write the number with
 * a dot in one place and a comma in the other. Same line, same unit, same number: one reading.
 */
test("a result binds to its fact across unit spelling and decimal separator", async () => {
  const line = "Синтетическая глюкоза 5,82 ммоль/л";
  const cyrillicPages = [{ ...twoLinePages[0], text: `${twoLinePages[0].text}\n${line}` }];
  const output = await lowEffortProvider(
    laboratoryAnswer({
      structuredResults: [
        {
          ...measurementResult("glucose", "Синтетическая глюкоза", "5.82", line),
          unit: "mmol/L",
        },
      ],
      facts: [
        {
          ...measurementFact("glucose", "Синтетическая глюкоза", "5,82", line),
          sourceUnit: "ммоль/л",
        },
      ],
    }),
  ).analyze({ contentType: "application/pdf", pages: cyrillicPages });
  assert.equal(output.intelligence.structuredResults[0]?.resultKey, "glucose");
  assert.equal(output.extraction.items[0]?.sourceValue, "5,82");
});
