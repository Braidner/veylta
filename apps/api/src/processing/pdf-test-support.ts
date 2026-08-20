/**
 * In-memory PDFs for the tests around the text layer and the vision path. Two modules need
 * them — the extractor's and the renderer's — so the builder lives here rather than in one
 * of their test files.
 */
export type PageImageKind = "inline" | "oversized";

export interface TextPdfOptions {
  readonly separateTextObjects?: boolean;
  /** Page number → the raster that page paints, so a test can build a picture page. */
  readonly images?: ReadonlyMap<number, PageImageKind>;
}

/** Four grey samples of a 2×2 image, carried inside the content stream itself. */
const inlineImage =
  "q 120 0 0 60 72 620 cm\nBI /W 2 /H 2 /CS /G /BPC 8 ID \u0000\u0040\u0080\u00c0\nEI\nQ";
const paintedImage = "q 120 0 0 60 72 620 cm\n/Im1 Do\nQ";
/** A 2000×2000 declaration: past `maxImageSize`, so pdf.js refuses it before reading a byte. */
const oversizedImageObject =
  "<< /Type /XObject /Subtype /Image /Width 2000 /Height 2000 /ColorSpace /DeviceGray" +
  " /BitsPerComponent 8 /Length 4 >>\nstream\n\u0000\u0040\u0080\u00c0\nendstream";

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

export function createTextPdf(
  pageLines: readonly (readonly string[])[],
  options: TextPdfOptions = {},
): Uint8Array {
  const objectBodies = new Map<number, string>();
  const pageObjectNumbers: number[] = [];
  let nextObject = 4;
  pageLines.forEach((lines, index) => {
    const image = options.images?.get(index + 1);
    const pageObject = nextObject++;
    const streamObject = nextObject++;
    const imageObject = image === "oversized" ? nextObject++ : null;
    pageObjectNumbers.push(pageObject);
    const painted = image === "inline" ? inlineImage : image === "oversized" ? paintedImage : "";
    const stream = [painted, textStream(lines, options.separateTextObjects)]
      .filter((part) => part.length > 0)
      .join("\n");
    const resources =
      imageObject === null
        ? "<< /Font << /F1 3 0 R >> >>"
        : `<< /Font << /F1 3 0 R >> /XObject << /Im1 ${imageObject} 0 R >> >>`;
    if (imageObject !== null) objectBodies.set(imageObject, oversizedImageObject);
    objectBodies.set(
      pageObject,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${resources} /Contents ${streamObject} 0 R >>`,
    );
    objectBodies.set(
      streamObject,
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    );
  });
  objectBodies.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objectBodies.set(
    2,
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageObjectNumbers.length} >>`,
  );
  objectBodies.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const chunks = ["%PDF-1.7\n"];
  const offsets = [0];
  for (let number = 1; number < nextObject; number += 1) {
    offsets[number] = Buffer.byteLength(chunks.join(""), "latin1");
    chunks.push(`${number} 0 obj\n${objectBodies.get(number)}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""), "latin1");
  chunks.push(`xref\n0 ${nextObject}\n`);
  chunks.push("0000000000 65535 f \n");
  for (let number = 1; number < nextObject; number += 1) {
    chunks.push(`${String(offsets[number]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${nextObject} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(chunks.join(""), "latin1");
}
