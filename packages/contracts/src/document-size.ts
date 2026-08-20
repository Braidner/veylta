/**
 * How large one local source may be, in the one place every layer reads it from.
 *
 * The number lives in four places that must agree: this constant, the API upload route's
 * `bodyLimit` and multipart `fileSize`, the web server's cap on a proxied request body, and the
 * `byte_size` CHECK in the schema. When one of them lagged behind, a document inside the limit
 * was refused for the wrong reason — a 500 or a dead socket instead of a size the person can act
 * on — so tests hold each of them against these values rather than against a copied literal.
 */
export const MAX_SYNTHETIC_DOCUMENT_BYTES = 100 * 1024 * 1024;
/** @deprecated Use MAX_SYNTHETIC_DOCUMENT_BYTES for every supported local source. */
export const MAX_SYNTHETIC_PDF_BYTES = MAX_SYNTHETIC_DOCUMENT_BYTES;
/** The multipart framing one document part travels in: boundaries, headers, the filename. */
export const SYNTHETIC_DOCUMENT_MULTIPART_OVERHEAD_BYTES = 128 * 1024;
/**
 * The whole upload request, source plus framing. Every hop that bounds a request body must
 * admit this much, or a document inside the limit is truncated on the way in.
 */
export const MAX_SYNTHETIC_DOCUMENT_UPLOAD_BYTES =
  MAX_SYNTHETIC_DOCUMENT_BYTES + SYNTHETIC_DOCUMENT_MULTIPART_OVERHEAD_BYTES;
