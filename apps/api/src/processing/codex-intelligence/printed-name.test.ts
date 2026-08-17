import assert from "node:assert/strict";
import test from "node:test";
import { createCodexDocumentIntelligenceProvider } from "../codex-document-intelligence-provider.js";
import { unitlessMark } from "./readings.js";
import { executorFor, laboratoryAnswer } from "./test-support.js";

/**
 * A fact's name is the analyte name as the source prints it in the value's own row — never a
 * column header, a page label or the model's own key. When the model slips and names the fact
 * by its key or a header, and the household catalog knows the proposed code under a spelling
 * that is printed on that row, the printed spelling is taken deterministically; a name that
 * neither is on the row nor can be recovered drops the fact, and the verified rest is kept.
 */
const catalog = [
  {
    code: "cholesterol.total",
    displayName: "Холестерин общий",
    unit: "mmol/L",
    aliases: ["холестерин общий (cholesterol)", "холестерин общий"],
  },
  { code: "glucose", displayName: "Глюкоза", unit: "mmol/L", aliases: ["глюкоза"] },
];

const page = {
  pageNumber: 1,
  text: [
    "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
    "Анализ Результат Единицы Референс",
    "6,99 p Холестерин общий (Cholesterol) ммоль/л < 5,18",
    "5,03 p Коэффициент атерогенности < 4,00",
    "Глюкоза 4,61 ммоль/л 3,89 - 5,83",
    "Синтетический маркер X 12 synthetic-unit",
    "16",
    "Амилаза панкреатическая (Pancreatic",
    "amylase)   Ед/л 8 - 53",
  ].join("\n"),
  extractionMethod: "pdf_text_layer",
  extractionVersion: "pdfjs-dist/6.2.108",
} as const;

function fact(overrides: Record<string, unknown>) {
  return {
    factKey: "fact",
    sourceName: "Анализ",
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
  return provider.analyze({
    contentType: "application/pdf",
    pages: [page],
    analyteCatalog: catalog,
  });
}

test("a header, a key or a page label as the name is replaced by the printed spelling of the proposed code", async () => {
  const output = await analyzed([
    fact({ factKey: "a", sourceName: "Анализ", proposedCanonicalCode: "cholesterol.total" }),
    fact({
      factKey: "b",
      sourceName: "glucose",
      sourceValue: "4,61",
      proposedCanonicalCode: "glucose",
      source: { pageNumber: 1, fragment: "Глюкоза 4,61 ммоль/л 3,89 - 5,83" },
    }),
    fact({
      factKey: "c",
      sourceName: "page1",
      sourceValue: "4,61",
      proposedCanonicalCode: "glucose",
      source: { pageNumber: 1, fragment: "Глюкоза 4,61 ммоль/л 3,89 - 5,83" },
    }),
  ]);
  assert.deepEqual(
    output.extraction.items.map((item) => item.sourceName),
    ["Холестерин общий (Cholesterol)", "Глюкоза", "Глюкоза"],
  );
});

test("a printed name is kept as given, in the source's own casing when it differs", async () => {
  const output = await analyzed([
    fact({ factKey: "a", sourceName: "Холестерин общий (Cholesterol)" }),
    fact({
      factKey: "b",
      sourceName: "синтетический маркер x",
      sourceValue: "12",
      sourceUnit: "synthetic-unit",
      source: { pageNumber: 1, fragment: "Синтетический маркер X 12 synthetic-unit" },
    }),
  ]);
  assert.deepEqual(
    output.extraction.items.map((item) => item.sourceName),
    ["Холестерин общий (Cholesterol)", "Синтетический маркер X"],
  );
});

test("a name the source breaks over two lines is one phrase", async () => {
  const output = await analyzed([
    fact({
      factKey: "a",
      sourceName: "Амилаза панкреатическая (Pancreatic\namylase)",
      sourceValue: "16",
      sourceUnit: "Ед/л",
      source: {
        pageNumber: 1,
        fragment: "16\nАмилаза панкреатическая (Pancreatic\namylase)   Ед/л 8 - 53",
      },
    }),
  ]);
  assert.equal(
    output.extraction.items[0]?.sourceName,
    "Амилаза панкреатическая (Pancreatic amylase)",
  );
});

test("a name that is neither on the row nor recoverable drops that fact and keeps the rest", async () => {
  const output = await analyzed([
    fact({ factKey: "a", sourceName: "Холестерин общий (Cholesterol)" }),
    fact({
      factKey: "b",
      sourceName: "Lab",
      sourceValue: "12",
      sourceUnit: "synthetic-unit",
      source: { pageNumber: 1, fragment: "Синтетический маркер X 12 synthetic-unit" },
    }),
  ]);
  assert.deepEqual(
    output.extraction.items.map((item) => item.factKey),
    ["a"],
  );
});

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
