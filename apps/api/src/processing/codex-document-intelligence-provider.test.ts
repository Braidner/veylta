import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DOCUMENT_INTELLIGENCE_CONTRACT_VERSION } from "@veylta/contracts";
import {
  CodexDocumentIntelligenceError,
  createCodexDocumentIntelligenceProvider,
  type DocumentIntelligenceExecutor,
} from "./codex-document-intelligence-provider.js";

const pages = [
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

function executorFor(
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

test("Codex classifies a document and returns only source-bound review drafts", async () => {
  const calls: Array<{ arguments: readonly string[]; input: string; outputSchema: string }> = [];
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
          sampledAt: "2026-08-11T07:30:00.000Z",
          resultedAt: "2026-08-12T00:00:00.000Z",
          specimenType: "Венозная кровь",
          laboratory: "Синтетическая лаборатория",
          confidence: 0.96,
        },
        structuredResults: [
          {
            resultKey: "synthetic-glucose-result",
            type: "measurement",
            label: "Синтетическая глюкоза",
            value: "7.0",
            unit: "synthetic-unit",
            code: "synthetic.glucose",
            lab: "Синтетическая лаборатория",
            specimen: "Венозная кровь",
            date: "2026-08-12",
            status: "abnormal",
            confidence: 0.91,
            source: {
              pageNumber: 1,
              fragment: "Synthetic glucose: 7.0 synthetic-unit",
            },
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
            proposedResultedAt: "2026-08-12T00:00:00.000Z",
            proposedSpecimenType: null,
            proposedLaboratory: null,
            referenceRange: {
              sourceText: "< 6.0 synthetic-unit",
              sourceLow: null,
              sourceHigh: "6.0",
              sourceUnit: "synthetic-unit",
              laboratoryOutOfRange: true,
            },
            confidence: 0.91,
            validationIssues: [],
            source: {
              pageNumber: 1,
              fragment: [
                "Synthetic glucose: 7.0 synthetic-unit",
                "Reference: < 6.0 synthetic-unit",
              ].join("\n"),
            },
          },
        ],
      },
      calls,
    ),
  );

  const result = await provider.analyze({ contentType: "application/pdf", pages });

  assert.equal(result.intelligence.contractVersion, DOCUMENT_INTELLIGENCE_CONTRACT_VERSION);
  assert.equal(result.intelligence.provider, "codex");
  assert.equal(result.intelligence.category, "laboratory");
  assert.equal(
    result.intelligence.shortSummary,
    "В документе указан один синтетический лабораторный результат.",
  );
  assert.equal(result.intelligence.structuredResults[0]?.type, "measurement");
  assert.equal(result.intelligence.structuredResults[0]?.status, "above_range");
  assert.equal(result.intelligence.structuredResults[0]?.resultKey, "synthetic-glucose");
  assert.equal(
    result.intelligence.structuredResults[0]?.source.fragment,
    "Synthetic glucose: 7.0 synthetic-unit",
  );
  assert.equal(result.extraction.items.length, 1);
  assert.deepEqual(
    {
      laboratory: result.extraction.items[0]?.proposedLaboratory,
      resultedAt: result.extraction.items[0]?.proposedResultedAt,
      sampledAt: result.extraction.items[0]?.proposedSampledAt,
      specimenType: result.extraction.items[0]?.proposedSpecimenType,
    },
    {
      laboratory: "Синтетическая лаборатория",
      resultedAt: "2026-08-12T00:00:00.000Z",
      sampledAt: "2026-08-11T07:30:00.000Z",
      specimenType: "Венозная кровь",
    },
  );
  assert.equal(
    result.extraction.items[0]?.source.fragment,
    pages[0]?.text.split("\n").slice(2).join("\n"),
  );
  assert.equal(result.pages[0]?.textSha256.length, 64);
  assert.equal(calls.length, 1);
  assert.ok(calls[0]?.arguments.includes("--output-schema"));
  assert.ok(calls[0]?.arguments.includes("--ephemeral"));
  assert.ok(calls[0]?.arguments.includes("read-only"));
  assert.match(calls[0]?.input ?? "", /untrusted document content/i);
  assert.match(calls[0]?.input ?? "", /complete source line/i);
  assert.match(calls[0]?.input ?? "", /Russian/i);
  assert.match(calls[0]?.input ?? "", /omit patient names, addresses, phone numbers/i);
  assert.match(calls[0]?.input ?? "", /medical result code/i);
  assert.doesNotMatch(calls[0]?.input ?? "", /familyId|profileId|originalFilename/i);
  assert.doesNotMatch(calls[0]?.outputSchema ?? "", /"uniqueItems"/);
  const schema = JSON.parse(calls[0]?.outputSchema ?? "{}") as {
    properties?: {
      facts?: {
        items?: {
          properties?: {
            proposedSampledAt?: { anyOf?: Array<{ pattern?: string }> };
            proposedResultedAt?: { anyOf?: Array<{ pattern?: string }> };
            referenceRange?: {
              anyOf?: Array<{
                properties?: { sourceText?: { anyOf?: Array<{ pattern?: string }> } };
              }>;
            };
            source?: { properties?: { fragment?: { description?: string; minLength?: number } } };
          };
        };
      };
      structuredResults?: {
        maxItems?: number;
        items?: {
          properties?: {
            type?: { enum?: string[] };
            label?: { pattern?: string };
            status?: { enum?: string[] };
            source?: { properties?: { fragment?: { description?: string; minLength?: number } } };
          };
        };
      };
    };
  };
  const fragmentSchema = schema.properties?.facts?.items?.properties?.source?.properties?.fragment;
  assert.equal(fragmentSchema?.minLength, 12);
  assert.match(fragmentSchema?.description ?? "", /complete source line/i);
  const factProperties = schema.properties?.facts?.items?.properties;
  assert.match(factProperties?.proposedSampledAt?.anyOf?.[0]?.pattern ?? "", /T.*Z/);
  assert.equal(
    factProperties?.proposedSampledAt?.anyOf?.[0]?.pattern,
    factProperties?.proposedResultedAt?.anyOf?.[0]?.pattern,
  );
  assert.match(
    factProperties?.referenceRange?.anyOf?.[0]?.properties?.sourceText?.anyOf?.[0]?.pattern ?? "",
    /\\S/,
  );
  assert.match(calls[0]?.input ?? "", /canonical UTC timestamp/i);
  assert.match(calls[0]?.input ?? "", /null instead of an empty string/i);
  assert.match(calls[0]?.input ?? "", /unique factKey/i);
  assert.match(calls[0]?.input ?? "", /normalized value and normalized unit together/i);
  assert.match(calls[0]?.input ?? "", /sample time must not be later than the result time/i);
  assert.match(calls[0]?.input ?? "", /validationIssues must not contain duplicates/i);
  assert.match(calls[0]?.input ?? "", /document-level metadata/i);
  assert.equal(schema.properties?.structuredResults?.maxItems, 100);
  assert.deepEqual(schema.properties?.structuredResults?.items?.properties?.type?.enum, [
    "measurement",
    "genetic_variant",
    "finding",
    "procedure",
    "medication",
    "diagnosis",
    "other",
  ]);
  assert.deepEqual(schema.properties?.structuredResults?.items?.properties?.status?.enum, [
    "above_range",
    "normal",
    "abnormal",
    "detected",
    "not_detected",
    "completed",
    "informational",
    "unknown",
  ]);
  assert.match(calls[0]?.input ?? "", /above_range.*explicit source range/i);
  assert.match(
    schema.properties?.structuredResults?.items?.properties?.label?.pattern ?? "",
    /А-Я/,
  );
  assert.match(
    schema.properties?.structuredResults?.items?.properties?.source?.properties?.fragment
      ?.description ?? "",
    /complete source line/i,
  );
  assert.equal(calls.length, 1);
});

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

test("Codex can sort a non-laboratory document without inventing facts", async () => {
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

test("Codex provenance expands an exact context fragment to its complete source line", async () => {
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

const twoLinePages = [
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

function laboratoryAnswer(overrides: {
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

function measurementResult(resultKey: string, label: string, value: string, fragment: string) {
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

function measurementFact(factKey: string, sourceName: string, value: string, fragment: string) {
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

function lowEffortProvider(answer: unknown) {
  return createCodexDocumentIntelligenceProvider(
    {
      resolveExecutionProfile: async () => ({
        modelId: "gpt-5.4-mini",
        documentModelId: null,
        reasoningEffort: "low",
        documentReasoningEffort: "low",
        serviceTier: "standard",
      }),
      timeoutMs: 120_000,
    },
    executorFor(answer, []),
  );
}

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
        // Half a proposal — a value with no unit — is no proposal; the measurement itself stands.
        {
          ...measurementFact("half", "Synthetic lactate", "2.0", lactate),
          proposedNormalizedValue: "2.0",
          proposedNormalizedUnit: null,
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
      ["half", null, null],
    ],
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

test("Codex output fails closed when provenance is not an exact page fragment", async () => {
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

test("Codex output fails closed when a generic result label is not in Russian", async () => {
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

/**
 * A source without a text layer reaches Codex as page images. The model transcribes each page
 * itself and every fragment is checked against that transcription, so provenance still binds
 * to a page the owner can open and compare.
 */
test("page images are attached to Codex and fragments bind to the returned transcription", async () => {
  const calls: Array<{ arguments: readonly string[]; input: string; outputSchema: string }> = [];
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
        pages: [{ pageNumber: 1, text: "Synthetic glucose: 7.0 synthetic-unit\nReference: < 6.0" }],
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
            proposedCanonicalCode: null,
            proposedNormalizedValue: null,
            proposedNormalizedUnit: null,
            proposedSampledAt: null,
            proposedResultedAt: null,
            proposedSpecimenType: null,
            proposedLaboratory: null,
            referenceRange: {
              sourceText: "< 6.0",
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
      calls,
    ),
  );

  const output = await provider.analyze({
    contentType: "image/png",
    pages: [],
    images: [{ pageNumber: 1, contentType: "image/png", bytes: Buffer.from("png-bytes") }],
  });

  const call = calls[0];
  assert.ok(call !== undefined);
  const imageFlag = call.arguments.indexOf("--image");
  assert.ok(imageFlag >= 0, "the image must be attached with --image");
  assert.match(String(call.arguments[imageFlag + 1]), /page-1\.png$/);
  assert.match(call.outputSchema, /"pages"/);
  assert.equal(output.pages.length, 1);
  assert.equal(output.pages[0]?.extractionMethod, "codex_vision");
  assert.equal(output.extraction.items.length, 1);
  assert.equal(output.extraction.items[0]?.source.pageNumber, 1);
});

test("a vision answer whose fragment is not in its own transcription is refused", async () => {
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
        pages: [{ pageNumber: 1, text: "Nothing that mentions glucose here" }],
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
            status: "unknown",
            confidence: 0.9,
            source: { pageNumber: 1, fragment: "Synthetic glucose: 7.0 synthetic-unit" },
          },
        ],
        facts: [],
      },
      [],
    ),
  );

  await assert.rejects(
    () =>
      provider.analyze({
        contentType: "image/png",
        pages: [],
        images: [{ pageNumber: 1, contentType: "image/png", bytes: Buffer.from("png-bytes") }],
      }),
    (error: unknown) =>
      error instanceof CodexDocumentIntelligenceError && error.reason === "fragment_not_on_page",
  );
});

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
