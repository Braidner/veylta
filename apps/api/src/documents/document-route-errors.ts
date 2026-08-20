import type { FastifyReply, FastifyRequest } from "fastify";
import { errorEnvelope, sendDomainError } from "../http/route-helpers.js";
import {
  IdempotencyConflictError,
  InvalidDocumentSignatureError,
  UnsupportedDocumentTypeError,
  UploadTooLargeError,
} from "./document-service.js";

/** The upload part shape the route requires: exactly one supported file field named `file`. */
export class InvalidMultipartUploadError extends Error {}

export function attachmentDisposition(originalFilename: string): string {
  const cleaned = [...originalFilename]
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim();
  const fallback = [...cleaned]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 32 && codePoint <= 126 && character !== '"' && character !== "\\"
        ? character
        : "_";
    })
    .join("")
    .slice(0, 180);
  const safeFallback = fallback.length > 0 ? fallback : "document";
  const encoded = encodeURIComponent(cleaned.length > 0 ? cleaned : "document").replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${safeFallback}"; filename*=UTF-8''${encoded}`;
}

function isMultipartLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    ["FST_FILES_LIMIT", "FST_FIELDS_LIMIT", "FST_PARTS_LIMIT"].includes(
      String((error as { code: unknown }).code),
    )
  );
}

function isMultipartParseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error &&
      ["FST_INVALID_MULTIPART_CONTENT_TYPE", "FST_MULTIPART_INVALID_MEDIA_TYPE"].includes(
        String((error as { code: unknown }).code),
      )) ||
      error.name === "MultipartError" ||
      /^Unexpected end of (form|multipart data)$/.test(error.message))
  );
}

export function sendDocumentError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (error instanceof UnsupportedDocumentTypeError) {
    reply
      .code(415)
      .send(
        errorEnvelope(
          "UNSUPPORTED_DOCUMENT_TYPE",
          "Only a synthetic PDF, PNG, or JPEG is supported.",
          request.id,
        ),
      );
    return true;
  }
  if (error instanceof InvalidDocumentSignatureError) {
    reply
      .code(415)
      .send(
        errorEnvelope(
          "INVALID_DOCUMENT_SIGNATURE",
          "The file content does not match a supported document type.",
          request.id,
        ),
      );
    return true;
  }
  if (error instanceof UploadTooLargeError) {
    reply
      .code(413)
      .send(
        errorEnvelope("UPLOAD_TOO_LARGE", "The document exceeds the upload limit.", request.id),
      );
    return true;
  }
  if (error instanceof IdempotencyConflictError) {
    reply
      .code(409)
      .send(
        errorEnvelope(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used for another upload.",
          request.id,
        ),
      );
    return true;
  }
  if (
    error instanceof InvalidMultipartUploadError ||
    isMultipartLimitError(error) ||
    isMultipartParseError(error)
  ) {
    reply
      .code(400)
      .send(
        errorEnvelope(
          "INVALID_MULTIPART_UPLOAD",
          "Exactly one supported document file part is required.",
          request.id,
        ),
      );
    return true;
  }
  return sendDomainError(error, request, reply);
}
