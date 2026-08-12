import assert from "node:assert/strict";
import test from "node:test";
import { extractPdfTextLayer, PdfTextExtractionError } from "./pdf-text-extractor.js";

function escapePdfText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function textStream(lines: readonly string[], separateTextObjects = false): string {
  if (separateTextObjects) {
    return lines
      .map(
        (line, index) =>
          `BT\n/F1 12 Tf\n72 ${720 - index * 18} Td\n(${escapePdfText(line)}) Tj\nET`,
      )
      .join("\n");
  }
  const commands = lines.flatMap((line, index) => [
    ...(index === 0 ? [] : ["0 -18 Td"]),
    `(${escapePdfText(line)}) Tj`,
  ]);
  return ["BT", "/F1 12 Tf", "72 720 Td", ...commands, "ET"].join("\n");
}

function createTextPdf(
  pageLines: readonly (readonly string[])[],
  options: { separateTextObjects?: boolean } = {},
): Uint8Array {
  const objectBodies = new Map<number, string>();
  const pageObjectNumbers: number[] = [];
  let nextObject = 4;
  for (const lines of pageLines) {
    const pageObject = nextObject++;
    const streamObject = nextObject++;
    pageObjectNumbers.push(pageObject);
    const stream = textStream(lines, options.separateTextObjects);
    objectBodies.set(
      pageObject,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamObject} 0 R >>`,
    );
    objectBodies.set(
      streamObject,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  objectBodies.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objectBodies.set(
    2,
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`,
  );
  objectBodies.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const chunks = ["%PDF-1.7\n"];
  const offsets = [0];
  for (let number = 1; number < nextObject; number += 1) {
    offsets[number] = Buffer.byteLength(chunks.join(""));
    chunks.push(`${number} 0 obj\n${objectBodies.get(number)}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${nextObject}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let number = 1; number < nextObject; number += 1) {
    chunks.push(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${nextObject} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(chunks.join(""), "latin1");
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
    (error: unknown) =>
      error instanceof PdfTextExtractionError && error.code === "PDF_LIMIT_EXCEEDED",
  );
});

test("enforces page and extracted-text caps before returning partial output", async () => {
  const twoPages = createTextPdf([["page one"], ["page two"]]);
  await assert.rejects(
    extractPdfTextLayer(twoPages, { maxPages: 1 }),
    (error: unknown) =>
      error instanceof PdfTextExtractionError && error.code === "PDF_LIMIT_EXCEEDED",
  );

  const textHeavy = createTextPdf([["text exceeds cap"]]);
  await assert.rejects(
    extractPdfTextLayer(textHeavy, { maxPageTextCharacters: 4 }),
    (error: unknown) =>
      error instanceof PdfTextExtractionError && error.code === "PDF_LIMIT_EXCEEDED",
  );
});

test("preserves line boundaries emitted as empty EOL items between positioned text objects", async () => {
  const pdf = createTextPdf([["HEADER", "DISCLAIMER", "FACT|synthetic-analyte-a"]], {
    separateTextObjects: true,
  });

  const [page] = await extractPdfTextLayer(pdf);

  assert.equal(page?.text, "HEADER\nDISCLAIMER\nFACT|synthetic-analyte-a");
});
