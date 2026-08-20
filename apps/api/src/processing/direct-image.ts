import { loadImage } from "@napi-rs/canvas";
import {
  checkedDimensions,
  type DirectImageContentType,
  DocumentImageError,
  type DocumentPageImage,
  MAX_DOCUMENT_IMAGE_SOURCE_BYTES,
} from "./document-images.js";

const maximumImageHeaderBytes = 128 * 1024;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const jpegSignature = Buffer.from([255, 216, 255]);

function pngDimensions(bytes: Buffer): { height: number; width: number } {
  if (bytes.byteLength < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  return checkedDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
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
      return checkedDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
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
  if (bytes.byteLength > MAX_DOCUMENT_IMAGE_SOURCE_BYTES) {
    throw new DocumentImageError("IMAGE_LIMIT_EXCEEDED");
  }
  const expected = contentType === "image/png" ? pngDimensions(bytes) : jpegDimensions(bytes);
  let image: Awaited<ReturnType<typeof loadImage>>;
  try {
    image = await loadImage(bytes);
  } catch (error) {
    throw new DocumentImageError("INVALID_DOCUMENT", { cause: error });
  }
  const decoded = checkedDimensions(image.naturalWidth, image.naturalHeight);
  if (decoded.width !== expected.width || decoded.height !== expected.height) {
    throw new DocumentImageError("INVALID_DOCUMENT");
  }
  return { pageNumber: 1, contentType, bytes };
}
