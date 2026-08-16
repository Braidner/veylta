import { createHash } from "node:crypto";
import type { DocumentPageImage } from "../document-images.js";
import type { ExtractedPageText, ParsedDocumentPage } from "../synthetic-lab-parser.js";
import { transcribedPageFields } from "./answer-schema.js";
import { CODEX_VISION_EXTRACTION_METHOD, limits, versionPattern } from "./constants.js";
import { invalidInput, invalidOutput } from "./errors.js";
import { exactKeys, object } from "./field-parsers.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The document's own text layer, checked before it travels: bounded, unique page numbers. */
export function textLayerPages(pages: readonly ExtractedPageText[]): ParsedDocumentPage[] {
  if (pages.length === 0 || pages.length > limits.pages) invalidInput();
  const seen = new Set<number>();
  let totalCharacters = 0;
  return pages.map((page) => {
    totalCharacters += page.text.length;
    if (
      !Number.isSafeInteger(page.pageNumber) ||
      page.pageNumber < 1 ||
      seen.has(page.pageNumber) ||
      page.text.length === 0 ||
      page.text.length > limits.pageTextCharacters ||
      totalCharacters > limits.totalTextCharacters ||
      !versionPattern.test(page.extractionMethod) ||
      !versionPattern.test(page.extractionVersion)
    ) {
      invalidInput();
    }
    seen.add(page.pageNumber);
    return { ...page, textSha256: sha256(page.text) };
  });
}

/** A page transcription is multi-line by nature; only line breaks are allowed as control characters. */
function transcriptionText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > limits.pageTextCharacters
  ) {
    invalidOutput("schema_shape");
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 32 && code !== 10 && code !== 13 && code !== 9) || code === 127) {
      invalidOutput("schema_shape");
    }
  }
  return value.replaceAll("\r\n", "\n").trim();
}

/**
 * The model's transcription of attached page images becomes the page set every fragment is
 * checked against. Page numbers must be exactly the attached ones: no invented pages, none
 * missing, so provenance never names a page the owner cannot open.
 */
export function transcribedPages(
  value: unknown,
  images: readonly DocumentPageImage[],
  modelId: string,
  runtimeVersion: string,
): ParsedDocumentPage[] {
  if (!Array.isArray(value)) invalidOutput("schema_shape");
  const expected = new Set(images.map((image) => image.pageNumber));
  const seen = new Set<number>();
  const extractionVersion = `${modelId}+${runtimeVersion}`.replace(/[^a-z0-9._/+:-]/gi, "-");
  const pages = value.map((entry) => {
    const page = object(entry);
    exactKeys(page, transcribedPageFields);
    if (!Number.isSafeInteger(page.pageNumber)) invalidOutput("schema_shape");
    const pageNumber = page.pageNumber as number;
    if (!expected.has(pageNumber) || seen.has(pageNumber)) invalidOutput("unknown_page");
    seen.add(pageNumber);
    const text = transcriptionText(page.text);
    return {
      pageNumber,
      text,
      extractionMethod: CODEX_VISION_EXTRACTION_METHOD,
      extractionVersion,
      textSha256: sha256(text),
    };
  });
  if (seen.size !== expected.size) invalidOutput("unknown_page");
  return pages;
}
