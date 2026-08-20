import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createTextPdf } from "./pdf-test-support.js";
import {
  type ExtractedPdfPage,
  extractPdfTextLayer,
  IMAGE_ONLY_PAGE_TEXT_CHARACTERS,
  imageOnlyPages,
  PdfTextExtractionError,
} from "./pdf-text-extractor.js";

const imagePageFixture = fileURLToPath(
  new URL("../../../../fixtures/veylta-synthetic-image-page-report.pdf", import.meta.url),
);

function isLimitExceeded(error: unknown): boolean {
  return error instanceof PdfTextExtractionError && error.code === "PDF_LIMIT_EXCEEDED";
}

function page(pageNumber: number, characters: number, hasRasterImage: boolean): ExtractedPdfPage {
  return {
    pageNumber,
    text: "x".repeat(characters),
    extractionMethod: "pdf_text_layer",
    extractionVersion: "test",
    hasRasterImage,
  };
}

test("extracts ordered page text from a bounded in-memory PDF without detaching the input", async () => {
  const bytes = createTextPdf([
    ["VEYLTA SYNTHETIC LAB REPORT v1", "SYNTHETIC TEST DATA - NOT FOR MEDICAL USE"],
    ["FACT|synthetic-analyte-a|SYNTHETIC A|7.0|unit|reference|0.60|AMBIGUOUS_UNIT"],
  ]);
  const byteLength = bytes.byteLength;

  const pages = await extractPdfTextLayer(bytes);

  assert.equal(bytes.byteLength, byteLength);
  assert.deepEqual(
    pages.map(({ pageNumber, extractionMethod, extractionVersion }) => ({
      pageNumber,
      extractionMethod,
      extractionVersion,
    })),
    [
      {
        pageNumber: 1,
        extractionMethod: "pdf_text_layer",
        extractionVersion: "pdfjs-dist/6.2.108",
      },
      {
        pageNumber: 2,
        extractionMethod: "pdf_text_layer",
        extractionVersion: "pdfjs-dist/6.2.108",
      },
    ],
  );
  assert.match(pages[0]?.text ?? "", /^VEYLTA SYNTHETIC LAB REPORT v1/);
  assert.match(pages[1]?.text ?? "", /^FACT\|synthetic-analyte-a/);
});

test("rejects non-PDF, empty text layers, and inputs above the configured byte cap", async () => {
  await assert.rejects(
    extractPdfTextLayer(Buffer.from("not a pdf")),
    (error: unknown) => error instanceof PdfTextExtractionError && error.code === "INVALID_PDF",
  );
  await assert.rejects(
    extractPdfTextLayer(createTextPdf([[]])),
    (error: unknown) =>
      error instanceof PdfTextExtractionError && error.code === "TEXT_LAYER_MISSING",
  );
  const smallPdf = createTextPdf([["synthetic"]]);
  await assert.rejects(
    extractPdfTextLayer(smallPdf, { maxPdfBytes: smallPdf.byteLength - 1 }),
    isLimitExceeded,
  );
});

test("enforces page and extracted-text caps before returning partial output", async () => {
  const twoPages = createTextPdf([["page one"], ["page two"]]);
  await assert.rejects(extractPdfTextLayer(twoPages, { maxPages: 1 }), isLimitExceeded);

  const textHeavy = createTextPdf([["text exceeds cap"]]);
  await assert.rejects(
    extractPdfTextLayer(textHeavy, { maxPageTextCharacters: 4 }),
    isLimitExceeded,
  );
});

test("preserves line boundaries emitted as empty EOL items between positioned text objects", async () => {
  const pdf = createTextPdf([["HEADER", "DISCLAIMER", "FACT|synthetic-analyte-a"]], {
    separateTextObjects: true,
  });

  const [page] = await extractPdfTextLayer(pdf);

  assert.equal(page?.text, "HEADER\nDISCLAIMER\nFACT|synthetic-analyte-a");
});

test("marks the page that painted a raster image and leaves a text-only page unmarked", async () => {
  const bytes = createTextPdf([["page one"], ["page two"]], {
    images: new Map([[2, "inline" as const]]),
  });

  const pages = await extractPdfTextLayer(bytes);

  assert.deepEqual(
    pages.map((extracted) => extracted.hasRasterImage),
    [false, true],
  );
});

test("a page whose image pdf.js refuses to read still reports as carrying one", async () => {
  const bytes = createTextPdf([["figure 1 densitogram"]], {
    images: new Map([[1, "oversized" as const]]),
  });

  const [extracted] = await extractPdfTextLayer(bytes);

  assert.equal(extracted?.hasRasterImage, true);
  assert.equal(extracted?.text, "figure 1 densitogram");
});

test("refuses a page whose operator list is longer than the scan may examine", async () => {
  const bytes = createTextPdf([["one", "two", "three"]]);

  await assert.rejects(extractPdfTextLayer(bytes, { maxOperatorsPerPage: 2 }), isLimitExceeded);
});

test("a picture page needs both a raster image and less text than the threshold", () => {
  assert.deepEqual(
    imageOnlyPages([
      page(1, IMAGE_ONLY_PAGE_TEXT_CHARACTERS - 1, true),
      page(2, IMAGE_ONLY_PAGE_TEXT_CHARACTERS, true),
      page(3, 10, false),
      page(4, 10, true),
    ]),
    [1, 4],
  );
});

test("the synthetic image-page fixture reads as one text page and one picture page", async () => {
  const pages = await extractPdfTextLayer(new Uint8Array(readFileSync(imagePageFixture)));

  assert.equal(pages.length, 2);
  assert.equal(pages[0]?.hasRasterImage, false);
  assert.equal(pages[1]?.hasRasterImage, true);
  assert.ok(
    (pages[1]?.text.length ?? 0) < IMAGE_ONLY_PAGE_TEXT_CHARACTERS,
    "the picture page carries a header and a caption, not the values themselves",
  );
  assert.deepEqual(imageOnlyPages(pages), [2]);
});
