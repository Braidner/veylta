import { fileURLToPath } from "node:url";
import { type Canvas, createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
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

const maximumTotalPixels = 4_000_000;
const maximumImageHeaderBytes = 128 * 1024;
const pdfSignature = Buffer.from("%PDF-", "ascii");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpegSignature = Buffer.from([255, 216, 255]);
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

function validDimensions(width: number, height: number): { height: number; width: number } {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  if (width * height > MAXIMUM_DOCUMENT_IMAGE_PIXELS) {
    throw new DocumentImageError("IMAGE_LIMIT_EXCEEDED");
  }
  return { height, width };
}

function canvasDimensions(viewport: PageViewport): { height: number; width: number } {
  return validDimensions(Math.ceil(viewport.width), Math.ceil(viewport.height));
}

function limitedPageCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  if (value > MAXIMUM_DOCUMENT_IMAGE_PAGES) throw new DocumentImageError("IMAGE_LIMIT_EXCEEDED");
  return value;
}

/** Renders the first bounded pages of a PDF that carries no usable text layer. */
export async function renderPdfPagesToImages(pdfBytes: Uint8Array): Promise<DocumentPageImage[]> {
  if (
    pdfBytes.byteLength < pdfSignature.byteLength ||
    !Buffer.from(pdfBytes.buffer, pdfBytes.byteOffset, pdfSignature.byteLength).equals(pdfSignature)
  ) {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  if (pdfBytes.byteLength > MAX_SYNTHETIC_DOCUMENT_BYTES) {
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
    const pageCount = limitedPageCount(document.numPages);
    const images: DocumentPageImage[] = [];
    let totalPixels = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
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

function pngDimensions(bytes: Buffer): { height: number; width: number } {
  if (bytes.byteLength < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  return validDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
}

function jpegDimensions(bytes: Buffer): { height: number; width: number } {
  let offset = 2;
  const maximumOffset = Math.min(bytes.byteLength, maximumImageHeaderBytes);
  while (offset < maximumOffset) {
    while (offset < maximumOffset && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined) break;
    offset += 1;
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }
    if (offset + 2 > maximumOffset) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > maximumOffset) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (length < 7) break;
      return validDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  throw new DocumentImageError("INVALID_DOCUMENT");
}

/**
 * Accepts a direct PNG/JPEG upload as one page image. The header is checked before the
 * decoder runs, and the decoded size must match the header, so a crafted file cannot
 * describe itself as small and decode large.
 */
export async function checkedDirectImage(
  imageBytes: Uint8Array,
  contentType: DirectImageContentType,
): Promise<DocumentPageImage> {
  const bytes = Buffer.from(imageBytes.buffer, imageBytes.byteOffset, imageBytes.byteLength);
  const signature = contentType === "image/png" ? pngSignature : jpegSignature;
  if (
    bytes.byteLength < signature.byteLength ||
    !bytes.subarray(0, signature.byteLength).equals(signature)
  ) {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  if (bytes.byteLength > MAX_SYNTHETIC_DOCUMENT_BYTES) {
    throw new DocumentImageError("IMAGE_LIMIT_EXCEEDED");
  }
  const expected = contentType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(bytes);
  } catch (error) {
    throw new DocumentImageError("INVALID_DOCUMENT", { cause: error });
  }
  const decoded = validDimensions(image.naturalWidth, image.naturalHeight);
  if (decoded.width !== expected.width || decoded.height !== expected.height) {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  return { pageNumber: 1, contentType, bytes };
}
