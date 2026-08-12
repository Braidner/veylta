import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticImageOnlyPdf } from "../../test/synthetic-image-only-pdf.js";
import { normalizeLocalSyntheticOcrText } from "./local-synthetic-ocr.js";
import {
  extractPdfTextWithLocalSyntheticOcr,
  LOCAL_SYNTHETIC_PDF_OCR_METHOD,
} from "./pdf-ocr-extractor.js";

test("falls back to bounded local OCR for a synthetic image-only PDF", async () => {
  const lines = [
    "VEYLTA SYNTHETIC LAB REPORT v1",
    "SYNTHETIC TEST DATA - NOT FOR MEDICAL USE",
    "FACT|synthetic-analyte-a",
    "NAME|SYNTHETIC ANALYTE A",
    "VALUE|7.0",
    "UNIT|synthetic-unit",
    "RANGE|synthetic reference",
    "CONFIDENCE|0.60",
    "ISSUES|AMBIGUOUS_UNIT",
    "END",
  ];
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network access is forbidden");
  };
  let pages: Awaited<ReturnType<typeof extractPdfTextWithLocalSyntheticOcr>>;
  try {
    const document = createSyntheticImageOnlyPdf(lines);
    pages = await extractPdfTextWithLocalSyntheticOcr(document);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(pages.length, 1);
  assert.equal(pages[0]?.extractionMethod, LOCAL_SYNTHETIC_PDF_OCR_METHOD);
  assert.equal(
    pages[0]?.text,
    lines
      .map((line) =>
        line === "SYNTHETIC TEST DATA - NOT FOR MEDICAL USE"
          ? "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE"
          : line,
      )
      .join("\n"),
  );
  assert.equal(fetchCalls, 0);
});

test("repairs only known local-OCR static field artifacts before strict parsing", () => {
  const recognized = [
    "VEYLTA SYNTHETIC LAB REPORT v1",
    "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
    "FACT|synthetic-analyte-a",
    "NAME | SYNTHETIC ANALYTE A",
    "VALUE|7.0",
    "UNIT|synthetic-unit",
    "RANGE]|synthetic reference",
    "CONFIDENCE |0. 60",
    "ISSUES |AMBIGUOUS UNIT",
    "END",
  ].join("\n");

  assert.equal(
    normalizeLocalSyntheticOcrText(recognized),
    [
      "VEYLTA SYNTHETIC LAB REPORT v1",
      "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
      "FACT|synthetic-analyte-a",
      "NAME|SYNTHETIC ANALYTE A",
      "VALUE|7.0",
      "UNIT|synthetic-unit",
      "RANGE|synthetic reference",
      "CONFIDENCE|0.60",
      "ISSUES|AMBIGUOUS_UNIT",
      "END",
    ].join("\n"),
  );
});
