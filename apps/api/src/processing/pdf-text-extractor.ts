import { fileURLToPath } from "node:url";
import { MAX_SYNTHETIC_PDF_BYTES } from "@veylta/contracts";
import { getDocument, version as pdfjsVersion } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { ExtractedPageText } from "./synthetic-lab-parser.js";

export const PDF_TEXT_EXTRACTION_METHOD = "pdf_text_layer" as const;
export const PDF_TEXT_EXTRACTION_VERSION = `pdfjs-dist/${pdfjsVersion}` as const;

const pdfSignature = Buffer.from("%PDF-", "ascii");
const standardFontDataUrl = `${fileURLToPath(
  new URL("../../standard_fonts/", import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs")),
)}/`;
const defaultMaxPages = 50;
const defaultMaxPageTextCharacters = 250_000;
const defaultMaxTotalTextCharacters = 1_000_000;
const defaultMaxTextItemsPerPage = 50_000;

export type PdfTextExtractionErrorCode =
  | "INVALID_PDF"
  | "PDF_LIMIT_EXCEEDED"
  | "TEXT_LAYER_MISSING";

export interface PdfTextExtractionOptions {
  maxPdfBytes?: number;
  maxPages?: number;
  maxPageTextCharacters?: number;
  maxTotalTextCharacters?: number;
  maxTextItemsPerPage?: number;
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

export async function extractPdfTextLayer(
  pdfBytes: Uint8Array,
  options: PdfTextExtractionOptions = {},
): Promise<ExtractedPageText[]> {
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

    const pages: ExtractedPageText[] = [];
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
