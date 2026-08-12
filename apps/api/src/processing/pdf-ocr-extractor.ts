import { fileURLToPath } from "node:url";
import { type Canvas, createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { MAX_SYNTHETIC_PDF_BYTES } from "@veylta/contracts";
import {
  getDocument,
  type PageViewport,
  version as pdfjsVersion,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  createLocalSyntheticOcr,
  LocalSyntheticOcrError,
  MAXIMUM_LOCAL_SYNTHETIC_OCR_PIXELS,
} from "./local-synthetic-ocr.js";
import type { ExtractedPageText } from "./synthetic-lab-parser.js";

export const LOCAL_SYNTHETIC_PDF_OCR_METHOD = "local_synthetic_ocr" as const;
export const LOCAL_SYNTHETIC_PDF_OCR_VERSION =
  `pdfjs-dist/${pdfjsVersion}+tesseract.js/7.0.0+eng/1.0.0` as const;

const pdfSignature = Buffer.from("%PDF-", "ascii");
const standardFontDataUrl = `${fileURLToPath(
  new URL("../../standard_fonts/", import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs")),
)}/`;
const maximumOcrPages = 3;
const maximumTotalOcrPixels = 4_000_000;

export type PdfOcrExtractionErrorCode = "INVALID_PDF" | "PDF_LIMIT_EXCEEDED" | "OCR_FAILED";

export class PdfOcrExtractionError extends Error {
  constructor(
    readonly code: PdfOcrExtractionErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "PdfOcrExtractionError";
  }
}

interface PdfPage {
  cleanup(): void;
  getViewport(input?: { scale: number }): PageViewport;
  render(input: { canvas: Canvas; canvasContext: SKRSContext2D; viewport: PageViewport }): {
    promise: Promise<void>;
  };
}

interface PdfDocument {
  cleanup(): Promise<void>;
  getPage(pageNumber: number): Promise<PdfPage>;
  numPages: number;
}

type OcrDocumentParameters = Exclude<Parameters<typeof getDocument>[0], undefined> & {
  /** Keep untrusted PDF parsing free of JavaScript-generated helpers. */
  isEvalSupported: false;
  /** The legacy Node build supplies an internal fake worker, never a remote URL. */
  disableWorker: false;
};

function checkedPdf(input: Uint8Array): void {
  if (
    input.byteLength < pdfSignature.byteLength ||
    !Buffer.from(input.buffer, input.byteOffset, pdfSignature.byteLength).equals(pdfSignature)
  ) {
    throw new PdfOcrExtractionError("INVALID_PDF");
  }
  if (input.byteLength > MAX_SYNTHETIC_PDF_BYTES) {
    throw new PdfOcrExtractionError("PDF_LIMIT_EXCEEDED");
  }
}

function canvasDimensions(viewport: PageViewport): { height: number; width: number } {
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAXIMUM_LOCAL_SYNTHETIC_OCR_PIXELS
  ) {
    throw new PdfOcrExtractionError("PDF_LIMIT_EXCEEDED");
  }
  return { height, width };
}

function limitedPageCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new PdfOcrExtractionError("INVALID_PDF");
  }
  if (value > maximumOcrPages) throw new PdfOcrExtractionError("PDF_LIMIT_EXCEEDED");
  return value;
}

export async function extractPdfTextWithLocalSyntheticOcr(
  pdfBytes: Uint8Array,
): Promise<ExtractedPageText[]> {
  checkedPdf(pdfBytes);
  const parameters: OcrDocumentParameters = {
    data: new Uint8Array(pdfBytes),
    disableAutoFetch: true,
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    disableWorker: false,
    enableXfa: false,
    isEvalSupported: false,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
    maxImageSize: MAXIMUM_LOCAL_SYNTHETIC_OCR_PIXELS,
    standardFontDataUrl,
    stopAtErrors: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
  };
  const loadingTask = getDocument(parameters);
  let document: PdfDocument | undefined;
  try {
    document = (await loadingTask.promise) as unknown as PdfDocument;
    const pageCount = limitedPageCount(document.numPages);
    const ocr = createLocalSyntheticOcr();
    const pages: ExtractedPageText[] = [];
    let totalPixels = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const dimensions = canvasDimensions(viewport);
        totalPixels += dimensions.width * dimensions.height;
        if (totalPixels > maximumTotalOcrPixels) {
          throw new PdfOcrExtractionError("PDF_LIMIT_EXCEEDED");
        }
        const canvas = createCanvas(dimensions.width, dimensions.height);
        const context = canvas.getContext("2d");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const output = await ocr.recognize({
          pageNumber,
          png: canvas.toBuffer("image/png"),
        });
        pages.push({
          pageNumber,
          text: output.text,
          extractionMethod: LOCAL_SYNTHETIC_PDF_OCR_METHOD,
          extractionVersion: LOCAL_SYNTHETIC_PDF_OCR_VERSION,
        });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } catch (error) {
    if (error instanceof PdfOcrExtractionError) throw error;
    if (error instanceof LocalSyntheticOcrError) {
      throw new PdfOcrExtractionError(
        error.code === "OCR_LIMIT_EXCEEDED" ? "PDF_LIMIT_EXCEEDED" : "OCR_FAILED",
      );
    }
    throw new PdfOcrExtractionError("INVALID_PDF");
  } finally {
    await document?.cleanup().catch(() => undefined);
    await loadingTask.destroy();
  }
}
