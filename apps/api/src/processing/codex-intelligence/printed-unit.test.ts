import assert from "node:assert/strict";
import test from "node:test";
import { createCodexDocumentIntelligenceProvider } from "../codex-document-intelligence-provider.js";
import { unitlessMark } from "./readings.js";
import { executorFor, laboratoryAnswer } from "./test-support.js";

/**
 * What a printed reading looks like after the parser: the unit as printed or the unitless
 * mark — a range, a flag or a placeholder is never a unit — and stray whitespace around a
 * value or a range folded away instead of refusing the fact.
 */
const page = {
  pageNumber: 1,
  text: [
    "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
    "6,99 p Холестерин общий (Cholesterol) ммоль/л < 5,18",
    "5,03 p Коэффициент атерогенности < 4,00",
  ].join("\n"),
  extractionMethod: "pdf_text_layer",
  extractionVersion: "pdfjs-dist/6.2.108",
} as const;

function fact(overrides: Record<string, unknown>) {
  return {
    factKey: "fact",
    sourceName: "Холестерин общий (Cholesterol)",
    sourceValue: "6,99",
    sourceUnit: "ммоль/л",
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
    source: { pageNumber: 1, fragment: "6,99 p Холестерин общий (Cholesterol) ммоль/л < 5,18" },
    ...overrides,
  };
}

async function analyzed(facts: readonly unknown[]) {
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
    executorFor(laboratoryAnswer({ facts }), []),
  );
  return provider.analyze({ contentType: "application/pdf", pages: [page] });
}

test("a unitless row keeps the unitless mark: a range, a flag or a placeholder is not a unit", async () => {
  for (const sourceUnit of ["< 4,00", "не указана", "p", "—", "/", "ед. не указана"]) {
    const output = await analyzed([
      fact({
        factKey: "a",
        sourceName: "Коэффициент атерогенности",
        sourceValue: "5,03",
        sourceUnit,
        source: { pageNumber: 1, fragment: "5,03 p Коэффициент атерогенности < 4,00" },
      }),
    ]);
    assert.equal(output.extraction.items[0]?.sourceUnit, unitlessMark, sourceUnit);
  }
  assert.equal(unitlessMark, "—");
});

test("stray whitespace around a printed reading or range is a slip, not a refusal", async () => {
  const output = await analyzed([
    fact({
      factKey: "a",
      sourceName: "Холестерин общий (Cholesterol)",
      sourceValue: " 6,99",
      sourceUnit: "ммоль/л ",
      referenceRange: {
        sourceText: " < 5,18",
        sourceLow: null,
        sourceHigh: "5,18 ",
        sourceUnit: "ммоль/л",
        laboratoryOutOfRange: null,
      },
    }),
  ]);
  const item = output.extraction.items[0];
  assert.equal(item?.sourceValue, "6,99");
  assert.equal(item?.sourceUnit, "ммоль/л");
  assert.equal(item?.referenceRange?.sourceText, "< 5,18");
  assert.equal(item?.referenceRange?.sourceHigh, "5,18");
});
