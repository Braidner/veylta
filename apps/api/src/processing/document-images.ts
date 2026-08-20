import { fileURLToPath } from "node:url";
import { type Canvas, createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  getDocument,
  type PageViewport,
  version as pdfjsVersion,
} from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Bounded page images for a source that has no text layer. Codex reads them directly; nothing
 * here recognizes text. The bounds are the same ones the retired local OCR path enforced,
 * because they protect the renderer and the model transport, not the recognizer.
 */
export const DOCUMENT_IMAGE_RENDER_VERSION = `pdfjs-dist/${pdfjsVersion}+napi-rs-canvas/1.0.5`;
export const MAXIMUM_DOCUMENT_IMAGE_PIXELS = 2_000_000;
export const MAXIMUM_DOCUMENT_IMAGE_PAGES = 3;
/**
 * The largest source `renderPdfPagesToImages`/`checkedDirectImage` will hand to pdf.js/canvas
 * for rasterisation. This is a different question from what the household may keep in storage
 * (`MAX_SYNTHETIC_DOCUMENT_BYTES` in `@veylta/contracts`): pulling a source near the storage
 * ceiling into memory whole to rasterise it would strain the renderer, so the vision path stays
 * bounded well under that ceiling regardless of how large an upload the household may keep.
 */
export const MAX_DOCUMENT_IMAGE_SOURCE_BYTES = 32 * 1024 * 1024;

const maximumTotalPixels = 4_000_000;
const pdfSignature = Buffer.from("%PDF-", "ascii");
const standardFontDataUrl = `${fileURLToPath(
  new URL("../../standard_fonts/", import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs")),
)}/`;

export type DirectImageContentType = "image/png" | "image/jpeg";
export type DocumentImageErrorCode = "INVALID_DOCUMENT" | "IMAGE_LIMIT_EXCEEDED";

export class DocumentImageError extends Error {
  constructor(
    readonly code: DocumentImageErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "DocumentImageError";
  }
}

export interface DocumentPageImage {
  readonly pageNumber: number;
  readonly contentType: DirectImageContentType;
  readonly bytes: Buffer;
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

type RenderParameters = Exclude<Parameters<typeof getDocument>[0], undefined> & {
  /** Keep untrusted PDF parsing free of JavaScript-generated helpers. */
  isEvalSupported: false;
  /** The legacy Node build supplies an internal fake worker, never a remote URL. */
  disableWorker: false;
};

/** The one per-image pixel bound, shared with the direct-upload reader beside this file. */
export function checkedDimensions(
  width: number,
  height: number,
): { height: number; width: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  if (width * height > MAXIMUM_DOCUMENT_IMAGE_PIXELS) {
    throw new DocumentImageError("IMAGE_LIMIT_EXCEEDED");
  }
  return { height, width };
}

function canvasDimensions(viewport: PageViewport): { height: number; width: number } {
  return checkedDimensions(Math.ceil(viewport.width), Math.ceil(viewport.height));
}

/**
 * The pages to render, in page order. Without a request this is the whole document, which must
 * therefore fit the page cap. With one — the picture pages of a document read as text — more
 * candidates than the cap is not an error: the first fit, and the caller reads which page
 * numbers came back to learn which ones it must report as unread.
 */
function requestedPages(pageCount: unknown, requested: readonly number[] | undefined): number[] {
  if (typeof pageCount !== "number" || !Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  if (requested === undefined) {
    if (pageCount > MAXIMUM_DOCUMENT_IMAGE_PAGES) {
      throw new DocumentImageError("IMAGE_LIMIT_EXCEEDED");
    }
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  const pages = [...new Set(requested)].sort((left, right) => left - right);
  for (const page of pages) {
    if (!Number.isSafeInteger(page) || page < 1 || page > pageCount) {
      throw new DocumentImageError("INVALID_DOCUMENT");
    }
  }
  return pages.slice(0, MAXIMUM_DOCUMENT_IMAGE_PAGES);
}

export interface DocumentImageRenderOptions {
  /** Render exactly these page numbers instead of the whole document. */
  readonly pages?: readonly number[];
}

/** Renders bounded page images of a PDF: the whole document, or the pages the caller names. */
export async function renderPdfPagesToImages(
  pdfBytes: Uint8Array,
  options: DocumentImageRenderOptions = {},
): Promise<DocumentPageImage[]> {
  if (
    pdfBytes.byteLength < pdfSignature.byteLength ||
    !Buffer.from(pdfBytes.buffer, pdfBytes.byteOffset, pdfSignature.byteLength).equals(pdfSignature)
  ) {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  if (pdfBytes.byteLength > MAX_DOCUMENT_IMAGE_SOURCE_BYTES) {
    throw new DocumentImageError("IMAGE_LIMIT_EXCEEDED");
  }
  const parameters: RenderParameters = {
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
    maxImageSize: MAXIMUM_DOCUMENT_IMAGE_PIXELS,
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
    const images: DocumentPageImage[] = [];
    let totalPixels = 0;
    for (const pageNumber of requestedPages(document.numPages, options.pages)) {
      const page = await document.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const dimensions = canvasDimensions(viewport);
        totalPixels += dimensions.width * dimensions.height;
        if (totalPixels > maximumTotalPixels) throw new DocumentImageError("IMAGE_LIMIT_EXCEEDED");
        const canvas = createCanvas(dimensions.width, dimensions.height);
        await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
        images.push({ pageNumber, contentType: "image/png", bytes: canvas.toBuffer("image/png") });
      } finally {
        page.cleanup();
      }
    }
    return images;
  } catch (error) {
    if (error instanceof DocumentImageError) throw error;
    throw new DocumentImageError("INVALID_DOCUMENT", { cause: error });
  } finally {
    await document?.cleanup().catch(() => undefined);
    await loadingTask.destroy();
  }
}
