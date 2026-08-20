import { fileURLToPath } from "node:url";
import { MAX_SYNTHETIC_PDF_BYTES } from "@veylta/contracts";
import { getDocument, OPS, version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ExtractedPageText } from "./synthetic-lab-parser.js";

export const PDF_TEXT_EXTRACTION_METHOD = "pdf_text_layer" as const;
export const PDF_TEXT_EXTRACTION_VERSION = `pdfjs-dist/${pdfjsVersion}` as const;
/**
 * Below this many characters, a page that also painted a raster image carries a letterhead and
 * maybe a caption while its content was drawn, not printed: the real densitometry page that
 * started this had 608. A page whose values were printed as text runs past a thousand, so the
 * cut sits between the two shapes rather than close to either.
 */
export const IMAGE_ONLY_PAGE_TEXT_CHARACTERS = 800;

const pdfSignature = Buffer.from("%PDF-", "ascii");
const standardFontDataUrl = `${fileURLToPath(
  new URL("../../standard_fonts/", import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs")),
)}/`;
const defaultMaxPages = 50;
const defaultMaxPageTextCharacters = 250_000;
const defaultMaxTotalTextCharacters = 1_000_000;
const defaultMaxTextItemsPerPage = 50_000;
const defaultMaxOperatorsPerPage = 100_000;
const rasterPaintOperators: ReadonlySet<number> = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
]);

export type PdfTextExtractionErrorCode =
  | "INVALID_PDF"
  | "PDF_LIMIT_EXCEEDED"
  | "TEXT_LAYER_MISSING";

/** A page of the text layer plus what the text pass could see about how it was drawn. */
export interface ExtractedPdfPage extends ExtractedPageText {
  readonly hasRasterImage: boolean;
}

export interface PdfTextExtractionOptions {
  maxPdfBytes?: number;
  maxPages?: number;
  maxPageTextCharacters?: number;
  maxTotalTextCharacters?: number;
  maxTextItemsPerPage?: number;
  maxOperatorsPerPage?: number;
}

export class PdfTextExtractionError extends Error {
  constructor(readonly code: PdfTextExtractionErrorCode) {
    super(code);
    this.name = "PdfTextExtractionError";
  }
}

interface TextItemLike {
  str: string;
  hasEOL: boolean;
}

type DocumentParameters = Exclude<Parameters<typeof getDocument>[0], undefined> & {
  /** Explicitly disable JavaScript-generated parsing helpers for untrusted PDFs. */
  isEvalSupported: false;
  /** Node's legacy build supplies an internal fake worker; it never uses a remote worker URL. */
  disableWorker: false;
};

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive`);
  return value;
}

function isTextItem(value: unknown): value is TextItemLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "str" in value &&
    typeof value.str === "string" &&
    "hasEOL" in value &&
    typeof value.hasEOL === "boolean"
  );
}

function normalizedPageText(
  items: readonly unknown[],
  maxCharacters: number,
  maxItems: number,
): string {
  if (items.length > maxItems) throw new PdfTextExtractionError("PDF_LIMIT_EXCEEDED");
  let text = "";
  for (const item of items) {
    if (!isTextItem(item)) continue;
    if (item.str.length === 0) {
      if (item.hasEOL && text.length > 0 && !text.endsWith("\n")) text += "\n";
      continue;
    }
    if (text.length > 0 && !text.endsWith("\n")) text += " ";
    text += item.str.normalize("NFC");
    if (item.hasEOL) text += "\n";
    if (text.length > maxCharacters) throw new PdfTextExtractionError("PDF_LIMIT_EXCEEDED");
  }
  const normalized = text
    .replaceAll("\r\n", "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (normalized.length === 0) throw new PdfTextExtractionError("TEXT_LAYER_MISSING");
  return normalized;
}

/**
 * Whether the page painted a raster image — how a chart or a scan arrives inside an otherwise
 * textual PDF. A page pdf.js could not read the drawing operations of counts as carrying one:
 * an image past `maxImageSize` makes it abandon the page's operator list instead of reporting
 * the image, so a page that yielded text yet no drawing operation at all is precisely that
 * case. Either way the text the page already yielded stays good — this never fails a document.
 */
async function paintsRasterImage(
  page: { getOperatorList(): Promise<{ fnArray: readonly number[] }> },
  maxOperators: number,
): Promise<boolean> {
  let operators: readonly number[];
  try {
    operators = (await page.getOperatorList()).fnArray;
  } catch {
    return true;
  }
  if (operators.length > maxOperators) throw new PdfTextExtractionError("PDF_LIMIT_EXCEEDED");
  return operators.length === 0 || operators.some((operator) => rasterPaintOperators.has(operator));
}

/**
 * The pages a text pass could not read: a raster image sits on them and their text layer holds
 * less than a header and a caption. This is the one rule that decides «picture page».
 */
export function imageOnlyPages(pages: readonly ExtractedPdfPage[]): number[] {
  return pages
    .filter((page) => page.hasRasterImage && page.text.length < IMAGE_ONLY_PAGE_TEXT_CHARACTERS)
    .map((page) => page.pageNumber);
}

export async function extractPdfTextLayer(
  pdfBytes: Uint8Array,
  options: PdfTextExtractionOptions = {},
): Promise<ExtractedPdfPage[]> {
  const maxPdfBytes = positiveLimit(options.maxPdfBytes ?? MAX_SYNTHETIC_PDF_BYTES, "maxPdfBytes");
  const maxPages = positiveLimit(options.maxPages ?? defaultMaxPages, "maxPages");
  const maxPageTextCharacters = positiveLimit(
    options.maxPageTextCharacters ?? defaultMaxPageTextCharacters,
    "maxPageTextCharacters",
  );
  const maxTotalTextCharacters = positiveLimit(
    options.maxTotalTextCharacters ?? defaultMaxTotalTextCharacters,
    "maxTotalTextCharacters",
  );
  const maxTextItemsPerPage = positiveLimit(
    options.maxTextItemsPerPage ?? defaultMaxTextItemsPerPage,
    "maxTextItemsPerPage",
  );
  const maxOperatorsPerPage = positiveLimit(
    options.maxOperatorsPerPage ?? defaultMaxOperatorsPerPage,
    "maxOperatorsPerPage",
  );
  if (
    pdfBytes.byteLength < pdfSignature.byteLength ||
    !Buffer.from(pdfBytes.buffer, pdfBytes.byteOffset, pdfSignature.byteLength).equals(pdfSignature)
  ) {
    throw new PdfTextExtractionError("INVALID_PDF");
  }
  if (pdfBytes.byteLength > maxPdfBytes) {
    throw new PdfTextExtractionError("PDF_LIMIT_EXCEEDED");
  }

  // PDF.js may transfer ownership of a TypedArray. Copy so callers retain their verified snapshot.
  const ownedBytes = new Uint8Array(pdfBytes);
  const parameters: DocumentParameters = {
    data: ownedBytes,
    disableWorker: false,
    isEvalSupported: false,
    stopAtErrors: true,
    useWorkerFetch: false,
    useWasm: false,
    useSystemFonts: false,
    disableFontFace: true,
    enableXfa: false,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    maxImageSize: 1_000_000,
    standardFontDataUrl,
  };
  const loadingTask = getDocument(parameters);
  try {
    const document = await loadingTask.promise;
    if (!Number.isSafeInteger(document.numPages) || document.numPages < 1) {
      throw new PdfTextExtractionError("INVALID_PDF");
    }
    if (document.numPages > maxPages) throw new PdfTextExtractionError("PDF_LIMIT_EXCEEDED");

    const pages: ExtractedPdfPage[] = [];
    let totalTextCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      });
      const text = normalizedPageText(content.items, maxPageTextCharacters, maxTextItemsPerPage);
      totalTextCharacters += text.length;
      if (totalTextCharacters > maxTotalTextCharacters) {
        throw new PdfTextExtractionError("PDF_LIMIT_EXCEEDED");
      }
      pages.push({
        pageNumber,
        text,
        extractionMethod: PDF_TEXT_EXTRACTION_METHOD,
        extractionVersion: PDF_TEXT_EXTRACTION_VERSION,
        hasRasterImage: await paintsRasterImage(page, maxOperatorsPerPage),
      });
    }
    await document.cleanup();
    return pages;
  } catch (error) {
    if (error instanceof PdfTextExtractionError) throw error;
    throw new PdfTextExtractionError("INVALID_PDF");
  } finally {
    await loadingTask.destroy();
  }
}
