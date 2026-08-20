import type {
  DocumentIntelligenceStructuredResult,
  DocumentPageUnreadReason,
} from "@veylta/contracts";
import { CodexDocumentIntelligenceError } from "./codex-document-intelligence-provider.js";
import { KeyRegistry } from "./codex-intelligence/answer-items.js";
import { limits } from "./codex-intelligence/constants.js";
import {
  DocumentImageError,
  type DocumentImageRenderOptions,
  type DocumentPageImage,
} from "./document-images.js";
import type { DocumentAnalysis, UnreadDocumentPage } from "./document-intelligence-provider.js";
import { type ExtractedPdfPage, imageOnlyPages } from "./pdf-text-extractor.js";
import type { ParsedDocumentPage } from "./synthetic-lab-parser.js";

/**
 * The picture pages a second, vision run should read: the ones `imageOnlyPages` names, minus
 * every page the text pass already produced a verified fact or structured result on. A page
 * that yielded evidence has been read, whatever its character count — re-reading it would
 * spend a Codex call to replace verified text-layer provenance with a transcription of the
 * same page. The subtraction is a safety rule, not an optimisation.
 */
function candidatePages(pages: readonly ExtractedPdfPage[], analyzed: DocumentAnalysis): number[] {
  const read = new Set<number>();
  for (const item of analyzed.extraction.items) read.add(item.source.pageNumber);
  for (const result of analyzed.intelligence.structuredResults) read.add(result.source.pageNumber);
  return imageOnlyPages(pages).filter((pageNumber) => !read.has(pageNumber));
}

/**
 * A key repeated across the two passes is a bookkeeping slip, settled the way one answer's own
 * repeats are: the later holder takes a derived key. Every verified fact survives with its
 * fragment and value untouched, and a vision result that took its fact's key follows it, so
 * the pair stays joined.
 */
function visionKeys(text: DocumentAnalysis): (key: string) => string {
  const registry = new KeyRegistry([
    ...text.extraction.items.map((item) => item.factKey),
    ...text.intelligence.structuredResults.map((result) => result.resultKey),
  ]);
  const settled = new Map<string, string>();
  return (key) => {
    const claimed = settled.get(key) ?? registry.claim(key);
    settled.set(key, claimed);
    return claimed;
  };
}

/** One page per number: a page the vision pass transcribed replaces the text pass's own. */
function mergedPages(text: DocumentAnalysis, vision: DocumentAnalysis): ParsedDocumentPage[] {
  const pages = new Map(text.pages.map((page) => [page.pageNumber, page]));
  for (const page of vision.pages) pages.set(page.pageNumber, page);
  return [...pages.values()].sort((left, right) => left.pageNumber - right.pageNumber);
}

/**
 * One analysis out of two passes: the text pass stays the document's title, category and
 * summaries, while the vision pass adds the pages it transcribed with the facts and results
 * bound to them. Null when the two together outgrow what one analysis may carry, so the
 * caller completes the job with the text pass instead of losing it to a validation failure.
 */
function mergeAnalyses(text: DocumentAnalysis, vision: DocumentAnalysis): DocumentAnalysis | null {
  const key = visionKeys(text);
  const items = [
    ...text.extraction.items,
    ...vision.extraction.items.map((item) => ({ ...item, factKey: key(item.factKey) })),
  ];
  const structuredResults: DocumentIntelligenceStructuredResult[] = [
    ...text.intelligence.structuredResults,
    ...vision.intelligence.structuredResults.map((result) => ({
      ...result,
      resultKey: key(result.resultKey),
    })),
  ];
  if (items.length > limits.facts || structuredResults.length > limits.structuredResults) {
    return null;
  }
  return {
    ...text,
    pages: mergedPages(text, vision),
    extraction: { ...text.extraction, items },
    intelligence: { ...text.intelligence, structuredResults },
  };
}

function unread(
  pageNumbers: readonly number[],
  reason: DocumentPageUnreadReason,
): UnreadDocumentPage[] {
  return pageNumbers.map((pageNumber) => ({ pageNumber, reason }));
}

function withUnreadPages(
  analyzed: DocumentAnalysis,
  pages: readonly UnreadDocumentPage[],
): DocumentAnalysis {
  if (pages.length === 0) return analyzed;
  return {
    ...analyzed,
    unreadPages: [...(analyzed.unreadPages ?? []), ...pages].sort(
      (left, right) => left.pageNumber - right.pageNumber,
    ),
  };
}

/** The candidates one bounded run could not carry; the renderer reports them by omission. */
function beyondCap(candidates: readonly number[], sent: readonly number[]): number[] {
  const rendered = new Set(sent);
  return candidates.filter((pageNumber) => !rendered.has(pageNumber));
}

export interface ImagePageSecondPass {
  /** The verified text pass. It completes the job whatever the second pass does. */
  readonly analyzed: DocumentAnalysis;
  /** The text pass's own pages, carrying what it saw of how each one was drawn. */
  readonly pages: readonly ExtractedPdfPage[];
  readonly bytes: Uint8Array;
  readonly render: (
    bytes: Uint8Array,
    options: DocumentImageRenderOptions,
  ) => Promise<DocumentPageImage[]>;
  readonly analyze: (images: readonly DocumentPageImage[]) => Promise<DocumentAnalysis>;
}

/**
 * Reads the picture pages a text pass left behind and merges what comes back into one
 * analysis. Best-effort by construction: a refusal, a provider error or a failed render costs
 * the document nothing but those pages, which then say why they were never read.
 */
export async function readImagePages(pass: ImagePageSecondPass): Promise<DocumentAnalysis> {
  const candidates = candidatePages(pass.pages, pass.analyzed);
  if (candidates.length === 0) return pass.analyzed;
  // A render that never returned leaves nothing behind the page cap: every candidate is unread.
  let sent: readonly number[] = candidates;
  try {
    const images = await pass.render(pass.bytes, { pages: candidates });
    sent = images.map((image) => image.pageNumber);
    const merged = mergeAnalyses(pass.analyzed, await pass.analyze(images));
    if (merged !== null) {
      return withUnreadPages(merged, unread(beyondCap(candidates, sent), "image_page_limit"));
    }
  } catch (error) {
    // Only the second pass's own failures are swallowed here; a stopping worker still stops.
    if (
      !(error instanceof CodexDocumentIntelligenceError) &&
      !(error instanceof DocumentImageError)
    ) {
      throw error;
    }
  }
  return withUnreadPages(pass.analyzed, [
    ...unread(beyondCap(candidates, sent), "image_page_limit"),
    ...unread(sent, "vision_unavailable"),
  ]);
}
