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
      "Reference: 4.0 — 6.0 synthetic-unit",
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
        reasoningEffort: "medium",
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
              sourceText: "4.0 — 6.0 synthetic-unit",
              sourceLow: "4.0",
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
                "Reference: 4.0 — 6.0 synthetic-unit",
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
    "normal",
    "abnormal",
    "detected",
    "not_detected",
    "completed",
    "informational",
    "unknown",
  ]);
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

test("Codex can sort a non-laboratory document without inventing facts", async () => {
  const provider = createCodexDocumentIntelligenceProvider(
    {
      resolveExecutionProfile: async () => ({
        modelId: "gpt-5.4-mini",
        reasoningEffort: "medium",
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
        reasoningEffort: "medium",
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
        reasoningEffort: "medium",
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
        reasoningEffort: "medium",
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

test("Codex output fails closed when provenance is not an exact page fragment", async () => {
  const provider = createCodexDocumentIntelligenceProvider(
    {
      resolveExecutionProfile: async () => ({
        modelId: "gpt-5.4-mini",
        reasoningEffort: "medium",
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
        reasoningEffort: "medium",
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
      error instanceof CodexDocumentIntelligenceError && error.code === "OUTPUT_INVALID",
  );
});

test("Codex output fails closed when a generic result label is not in Russian", async () => {
  const provider = createCodexDocumentIntelligenceProvider(
    {
      resolveExecutionProfile: async () => ({
        modelId: "gpt-5.4-mini",
        reasoningEffort: "medium",
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
