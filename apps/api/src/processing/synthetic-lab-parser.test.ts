import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  type ExtractedPageText,
  parseSyntheticLabPages,
  reviewStatusForFact,
  SyntheticLabParseError,
} from "./synthetic-lab-parser.js";

const syntheticFactBlock = [
  "FACT|synthetic-analyte-a",
  "NAME|СИНТЕТИЧЕСКИЙ АНАЛИТ A",
  "VALUE|7.0",
  "UNIT|synthetic-unit",
  "RANGE|synthetic reference",
  "CONFIDENCE|0.60",
  "ISSUES|AMBIGUOUS_UNIT",
  "END",
].join("\n");

function syntheticPage(overrides: Partial<ExtractedPageText> = {}): ExtractedPageText {
  return {
    pageNumber: 1,
    text: [
      "VEYLTA SYNTHETIC LAB REPORT v1",
      "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
      syntheticFactBlock,
    ].join("\n"),
    extractionMethod: "pdf_text_layer",
    extractionVersion: "test-text-layer/v1",
    ...overrides,
  };
}

test("parses the narrow synthetic format into a strict fact with page provenance", () => {
  const page = syntheticPage();

  const parsed = parseSyntheticLabPages([page]);
  const extraction = parsed.extraction;

  assert.equal(extraction.schemaVersion, "lab-extraction/v1");
  assert.equal(extraction.extractorVersion, "synthetic-lab-text/v1");
  assert.deepEqual(parsed.pages, [
    {
      ...page,
      textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
    },
  ]);
  assert.deepEqual(extraction.items, [
    {
      factKey: "synthetic-analyte-a",
      sourceName: "СИНТЕТИЧЕСКИЙ АНАЛИТ A",
      sourceValue: "7.0",
      sourceUnit: "synthetic-unit",
      proposedCanonicalCode: null,
      proposedNormalizedValue: null,
      proposedNormalizedUnit: null,
      referenceRange: {
        sourceText: "synthetic reference",
        sourceLow: null,
        sourceHigh: null,
        sourceUnit: "synthetic-unit",
        laboratoryOutOfRange: null,
      },
      proposedSpecimenType: null,
      proposedSampledAt: null,
      proposedResultedAt: null,
      proposedLaboratory: null,
      confidence: 0.6,
      validationIssues: ["AMBIGUOUS_UNIT"],
      source: { pageNumber: 1, fragment: syntheticFactBlock },
    },
  ]);
  const firstFact = extraction.items[0];
  assert.ok(firstFact !== undefined);
  assert.equal(reviewStatusForFact(firstFact), "needs_review");
});

test("routes a low-confidence fact to review even without another issue", () => {
  const page = syntheticPage({
    text: syntheticPage()
      .text.replace("CONFIDENCE|0.60", "CONFIDENCE|0.70")
      .replace("ISSUES|AMBIGUOUS_UNIT", "ISSUES|NONE"),
  });

  const [fact] = parseSyntheticLabPages([page]).extraction.items;

  assert.equal(fact === undefined ? undefined : reviewStatusForFact(fact), "needs_review");
  assert.deepEqual(fact?.validationIssues, []);
});

test("keeps a valid high-confidence fact unconfirmed for later explicit review", () => {
  const page = syntheticPage({
    text: syntheticPage()
      .text.replace("CONFIDENCE|0.60", "CONFIDENCE|0.95")
      .replace("ISSUES|AMBIGUOUS_UNIT", "ISSUES|NONE"),
  });

  const [fact] = parseSyntheticLabPages([page]).extraction.items;

  assert.equal(fact === undefined ? undefined : reviewStatusForFact(fact), "extracted");
  assert.deepEqual(fact?.validationIssues, []);
});

test("rejects documents that are not the explicitly synthetic format", () => {
  assert.throws(
    () =>
      parseSyntheticLabPages([
        syntheticPage({ text: syntheticPage().text.replace("VEYLTA SYNTHETIC", "EXTERNAL") }),
      ]),
    (error: unknown) =>
      error instanceof SyntheticLabParseError && error.code === "UNSUPPORTED_SYNTHETIC_FORMAT",
  );
});

test("fails closed on malformed facts, unknown issues, duplicate keys, and invalid pages", () => {
  const cases: ExtractedPageText[][] = [
    [syntheticPage({ text: syntheticPage().text.replace("VALUE|7.0", "VALUE|") })],
    [
      syntheticPage({
        text: syntheticPage().text.replace("ISSUES|AMBIGUOUS_UNIT", "ISSUES|UNRECOGNIZED_ISSUE"),
      }),
    ],
    [syntheticPage({ text: `${syntheticPage().text}\n${syntheticFactBlock}` })],
    [syntheticPage({ pageNumber: 0 })],
  ];

  for (const pages of cases) {
    assert.throws(
      () => parseSyntheticLabPages(pages),
      (error: unknown) =>
        error instanceof SyntheticLabParseError && error.code === "INVALID_EXTRACTION_OUTPUT",
    );
  }
});

test("rejects empty and unexpectedly large parser inputs", () => {
  assert.throws(
    () => parseSyntheticLabPages([]),
    (error: unknown) =>
      error instanceof SyntheticLabParseError && error.code === "INVALID_EXTRACTION_OUTPUT",
  );
  assert.throws(
    () => parseSyntheticLabPages([syntheticPage({ text: "x".repeat(250_001) })]),
    (error: unknown) =>
      error instanceof SyntheticLabParseError && error.code === "INVALID_EXTRACTION_OUTPUT",
  );
});
