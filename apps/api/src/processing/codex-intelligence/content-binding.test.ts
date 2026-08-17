import assert from "node:assert/strict";
import test from "node:test";
import { createCodexDocumentIntelligenceProvider } from "../codex-document-intelligence-provider.js";
import { executorFor, laboratoryAnswer } from "./test-support.js";

/**
 * A model sometimes misquotes the row it read — swaps a row label, joins two printed lines
 * into one — while the reading itself is right. When the page prints exactly one place where
 * that value stands with its unit and its range, the fact binds to the page's own printed
 * line(s) there; what is stored is page text, never the model's quote. Anything ambiguous or
 * unhinted is still refused.
 */
const page = {
  pageNumber: 1,
  text: [
    "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
    "Липаза",
    "Название/показатель   Результат   Референсные значения **",
    "Активность   30 МЕ/л   13 - 60",
    "6,99   p Холестерин общий (Cholesterol)   ммоль/л < 5,18",
    "16",
    "Амилаза панкреатическая (Pancreatic",
    "amylase)   Ед/л 8 - 53",
    "Комментарий: значения от 16 до 30 Ед/л считаются типичными.",
  ].join("\n"),
  extractionMethod: "pdf_text_layer",
  extractionVersion: "pdfjs-dist/6.2.108",
} as const;

function fact(overrides: Record<string, unknown>) {
  return {
    factKey: "fact",
    sourceName: "Липаза",
    sourceValue: "30",
    sourceUnit: "МЕ/л",
    proposedCanonicalCode: null,
    proposedNormalizedValue: null,
    proposedNormalizedUnit: null,
    proposedSampledAt: null,
    proposedResultedAt: null,
    proposedSpecimenType: null,
    proposedLaboratory: null,
    referenceRange: {
      sourceText: "13 - 60",
      sourceLow: "13",
      sourceHigh: "60",
      sourceUnit: "МЕ/л",
      laboratoryOutOfRange: null,
    },
    confidence: 0.9,
    validationIssues: [],
    source: { pageNumber: 1, fragment: "Концентрация   30 МЕ/л   13 - 60" },
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

test("a misquoted row label binds to the one printed line carrying the value, unit and range", async () => {
  const output = await analyzed([fact({ factKey: "a" })]);
  assert.equal(output.extraction.items.length, 1);
  assert.equal(output.extraction.items[0]?.source.fragment, "Активность   30 МЕ/л   13 - 60");
  assert.equal(output.extraction.items[0]?.sourceName, "Липаза");
});

test("two printed lines joined into one bind to the printed block around the value", async () => {
  const output = await analyzed([
    fact({
      factKey: "b",
      sourceName: "Амилаза панкреатическая (Pancreatic amylase)",
      sourceValue: "16",
      sourceUnit: "Ед/л",
      referenceRange: {
        sourceText: "8 - 53",
        sourceLow: "8",
        sourceHigh: "53",
        sourceUnit: "Ед/л",
        laboratoryOutOfRange: null,
      },
      source: {
        pageNumber: 1,
        fragment: "16   Амилаза панкреатическая (Pancreatic amylase)   Ед/л 8 - 53",
      },
    }),
  ]);
  assert.equal(output.extraction.items.length, 1);
  assert.equal(
    output.extraction.items[0]?.source.fragment,
    "16\nАмилаза панкреатическая (Pancreatic\namylase)   Ед/л 8 - 53",
  );
});

test("without a unit or range to pin the line, or with two candidate lines, the fact is refused", async () => {
  const unhinted = await analyzed([
    fact({ factKey: "a" }),
    fact({
      factKey: "c",
      sourceValue: "16",
      sourceUnit: "—",
      referenceRange: null,
      source: { pageNumber: 1, fragment: "Показатель 16 без единиц и референса" },
    }),
  ]);
  assert.deepEqual(
    unhinted.extraction.items.map((item) => item.factKey),
    ["a"],
  );
  const ambiguous = await analyzed([
    fact({ factKey: "a" }),
    fact({
      factKey: "d",
      sourceValue: "16",
      sourceUnit: "Ед/л",
      referenceRange: null,
      source: { pageNumber: 1, fragment: "Показатель 16 Ед/л на двух строках" },
    }),
  ]);
  assert.deepEqual(
    ambiguous.extraction.items.map((item) => item.factKey),
    ["a"],
    "«16 … Ед/л» is printed twice on the page — the comment line too — so nothing binds",
  );
});
