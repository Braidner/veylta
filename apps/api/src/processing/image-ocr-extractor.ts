import { createCanvas, loadImage } from "@napi-rs/canvas";
import { MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
import {
  createLocalSyntheticOcr,
  LocalSyntheticOcrError,
  MAXIMUM_LOCAL_SYNTHETIC_OCR_PIXELS,
} from "./local-synthetic-ocr.js";
import type { ExtractedPageText } from "./synthetic-lab-parser.js";

export const LOCAL_SYNTHETIC_IMAGE_OCR_METHOD = "local_synthetic_image_ocr" as const;
export const LOCAL_SYNTHETIC_IMAGE_OCR_VERSION =
  "napi-rs-canvas/1.0.5+tesseract.js/7.0.0+eng/1.0.0" as const;

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpegSignature = Buffer.from([255, 216, 255]);
const maximumImageHeaderBytes = 128 * 1024;

export type DirectImageContentType = "image/png" | "image/jpeg";
export type ImageOcrExtractionErrorCode = "INVALID_IMAGE" | "IMAGE_LIMIT_EXCEEDED" | "OCR_FAILED";

export class ImageOcrExtractionError extends Error {
  constructor(
    readonly code: ImageOcrExtractionErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = "ImageOcrExtractionError";
  }
}

function hasExpectedSignature(input: Uint8Array, contentType: DirectImageContentType): boolean {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const signature = contentType === "image/png" ? pngSignature : jpegSignature;
  return (
    bytes.byteLength >= signature.byteLength &&
    bytes.subarray(0, signature.byteLength).equals(signature)
  );
}

function supportedImage(input: Uint8Array, contentType: DirectImageContentType): void {
  if (!hasExpectedSignature(input, contentType)) {
    throw new ImageOcrExtractionError("INVALID_IMAGE");
  }
  if (input.byteLength > MAX_SYNTHETIC_DOCUMENT_BYTES) {
    throw new ImageOcrExtractionError("IMAGE_LIMIT_EXCEEDED");
  }
}

function validDimensions(
  width: number,
  height: number,
): {
  height: number;
  width: number;
} {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new ImageOcrExtractionError("INVALID_IMAGE");
  }
  if (width * height > MAXIMUM_LOCAL_SYNTHETIC_OCR_PIXELS) {
    throw new ImageOcrExtractionError("IMAGE_LIMIT_EXCEEDED");
  }
  return { height, width };
}

function pngDimensions(bytes: Buffer): { height: number; width: number } {
  if (bytes.byteLength < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new ImageOcrExtractionError("INVALID_IMAGE");
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
  throw new ImageOcrExtractionError("INVALID_IMAGE");
}

function dimensionsFromHeader(
  input: Uint8Array,
  contentType: DirectImageContentType,
): { height: number; width: number } {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  return contentType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
}

export async function extractImageTextWithLocalSyntheticOcr(
  imageBytes: Uint8Array,
  contentType: DirectImageContentType,
): Promise<ExtractedPageText[]> {
  supportedImage(imageBytes, contentType);
  try {
    const expectedDimensions = dimensionsFromHeader(imageBytes, contentType);
    const image = await loadImage(Buffer.from(imageBytes));
    const size = validDimensions(image.naturalWidth, image.naturalHeight);
    if (size.width !== expectedDimensions.width || size.height !== expectedDimensions.height) {
      throw new ImageOcrExtractionError("INVALID_IMAGE");
    }
    const canvas = createCanvas(size.width, size.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, size.width, size.height);
    const ocr = createLocalSyntheticOcr();
    const recognized = await ocr.recognize({ pageNumber: 1, png: canvas.toBuffer("image/png") });
    return [
      {
        pageNumber: 1,
        text: recognized.text,
        extractionMethod: LOCAL_SYNTHETIC_IMAGE_OCR_METHOD,
        extractionVersion: LOCAL_SYNTHETIC_IMAGE_OCR_VERSION,
      },
    ];
  } catch (error) {
    if (error instanceof ImageOcrExtractionError) throw error;
    if (error instanceof LocalSyntheticOcrError) {
      throw new ImageOcrExtractionError(
        error.code === "OCR_LIMIT_EXCEEDED" ? "IMAGE_LIMIT_EXCEEDED" : "OCR_FAILED",
        { cause: error },
      );
    }
    throw new ImageOcrExtractionError("INVALID_IMAGE", { cause: error });
  }
}
