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

test("Codex can sort a non-laboratory document without inventing facts", async () => {
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
          category: "consultation",
          title: "Синтетическая консультация",
          shortSummary: "Краткое синтетическое описание консультации.",
          detailedSummary: "Документ не содержит количественных лабораторных измерений.",
          documentDate: null,
          sampledAt: null,
          resultedAt: null,
          specimenType: null,
          laboratory: null,
          confidence: 0.84,
        },
        structuredResults: [],
        facts: [],
      },
      [],
    ),
  );

  const result = await provider.analyze({ contentType: "application/pdf", pages });

  assert.equal(result.intelligence.category, "consultation");
  assert.deepEqual(result.extraction.items, []);
});

test("Codex drops an impossible optional calendar date without losing sourced results", async () => {
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
          title: "Синтетическое исследование",
          shortSummary: "Краткое синтетическое описание исследования.",
          detailedSummary: "Документ содержит один результат с точной привязкой к источнику.",
          documentDate: "2026-02-31",
          sampledAt: null,
          resultedAt: null,
          specimenType: null,
          laboratory: null,
          confidence: 0.9,
        },
        structuredResults: [
          {
            resultKey: "synthetic-result",
            type: "finding",
            label: "Синтетический результат",
            value: "7.0",
            unit: "synthetic-unit",
            code: null,
            lab: null,
            specimen: null,
            date: "2026-02-31",
            status: "informational",
            confidence: 0.9,
            source: {
              pageNumber: 1,
              fragment: "Synthetic glucose: 7.0 synthetic-unit",
            },
          },
        ],
        facts: [],
      },
      [],
    ),
  );

  const result = await provider.analyze({ contentType: "application/pdf", pages });

  assert.equal(result.intelligence.documentDate, null);
  assert.equal(result.intelligence.structuredResults[0]?.date, null);
  assert.equal(result.intelligence.structuredResults.length, 1);
});

test("Codex keeps source-bound facts when another proposed fact fails validation", async () => {
  const validFact = {
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
      fragment: "Synthetic glucose: 7.0 synthetic-unit",
    },
  };
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
          validFact,
          {
            ...validFact,
            factKey: "invented",
            source: { pageNumber: 1, fragment: "This text is not in the source" },
          },
        ],
      },
      [],
    ),
  );

  const result = await provider.analyze({ contentType: "application/pdf", pages });

  assert.equal(result.extraction.items.length, 1);
  assert.equal(result.extraction.items[0]?.factKey, "synthetic-glucose");
});

/**
 * A summary that lists numeric measurements the facts list never picked up is an incomplete
 * extraction, not a finished one: accepting it would put a fraction of the document in front
 * of the reviewer as if it were everything. Refusing lets the ordinary retry ask again.
 */
test("an answer whose facts miss most of its own numeric measurements is refused as incomplete", async () => {
  const glucose = "Synthetic glucose: 7.0 synthetic-unit";
  const lactate = "Synthetic lactate: 2.0 synthetic-unit";
  const results = [
    measurementResult("glucose", "Синтетическая глюкоза", "7.0", glucose),
    measurementResult("lactate", "Синтетический лактат", "2.0", lactate),
  ];

  await assert.rejects(
    () =>
      lowEffortProvider(laboratoryAnswer({ structuredResults: results, facts: [] })).analyze({
        contentType: "application/pdf",
        pages: twoLinePages,
      }),
    (error: unknown) =>
      error instanceof CodexDocumentIntelligenceError && error.reason === "incomplete_facts",
  );

  // Half of the measurements reviewed is still a usable answer; the reviewer sees the rest in
  // the summary and can restart. Only a summary that mostly outruns the facts is refused.
  const partial = await lowEffortProvider(
    laboratoryAnswer({
      structuredResults: results,
      facts: [measurementFact("glucose", "Synthetic glucose", "7.0", glucose)],
    }),
  ).analyze({ contentType: "application/pdf", pages: twoLinePages });
  assert.equal(partial.extraction.items.length, 1);

  // Outside a laboratory report a measurement is not a laboratory fact — a clinical note with
  // pressures or anthropometrics legitimately has zero facts.
  const answer = laboratoryAnswer({ structuredResults: results, facts: [] });
  const clinical = await lowEffortProvider({
    ...answer,
    classification: { ...answer.classification, category: "other" },
  }).analyze({ contentType: "application/pdf", pages: twoLinePages });
  assert.equal(clinical.intelligence.structuredResults.length, 2);
});

/**
 * One invented line among verified results is dropped exactly like an invented fact: nothing
 * unbound ever surfaces, and the verified rest of the answer is not thrown away with it.
 */
test("an unbound generic result is dropped while the verified results and facts are kept", async () => {
  const glucose = "Synthetic glucose: 7.0 synthetic-unit";
  const output = await lowEffortProvider(
    laboratoryAnswer({
      structuredResults: [
        measurementResult("glucose", "Синтетическая глюкоза", "7.0", glucose),
        {
          ...measurementResult("invented", "Синтетическая находка", "1.0", "No such line here"),
          type: "finding",
        },
      ],
      facts: [measurementFact("glucose", "Synthetic glucose", "7.0", glucose)],
    }),
  ).analyze({ contentType: "application/pdf", pages: twoLinePages });

  assert.deepEqual(
    output.intelligence.structuredResults.map((result) => result.resultKey),
    ["glucose"],
  );
  assert.equal(output.extraction.items.length, 1);
});
