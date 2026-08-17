import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexDocumentIntelligenceError,
  createCodexDocumentIntelligenceProvider,
} from "../codex-document-intelligence-provider.js";
import { executorFor } from "./test-support.js";

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
        assistantReasoningEffort: "high",
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
        assistantReasoningEffort: "high",
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
