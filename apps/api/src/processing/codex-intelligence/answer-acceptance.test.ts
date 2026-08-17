import assert from "node:assert/strict";
import test from "node:test";
import { DOCUMENT_INTELLIGENCE_CONTRACT_VERSION } from "@veylta/contracts";
import { createCodexDocumentIntelligenceProvider } from "../codex-document-intelligence-provider.js";
import { executorFor, pages } from "./test-support.js";

test("Codex classifies a document and returns only source-bound review drafts", async () => {
  const calls: Array<{ arguments: readonly string[]; input: string; outputSchema: string }> = [];
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
