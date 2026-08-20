import assert from "node:assert/strict";
import test from "node:test";
import { analysis, fact, measurement, parsedPage, pdfPage } from "./analysis-test-support.js";
import { CodexDocumentIntelligenceError } from "./codex-document-intelligence-provider.js";
import { limits } from "./codex-intelligence/constants.js";
import { DocumentImageError, type DocumentPageImage } from "./document-images.js";
import type { DocumentAnalysis } from "./document-intelligence-provider.js";
import { readImagePages } from "./extraction-merge.js";
import type { ExtractedPdfPage } from "./pdf-text-extractor.js";

interface Calls {
  readonly rendered: number[][];
  readonly analyzed: number[][];
}

function pageImages(pageNumbers: readonly number[]): DocumentPageImage[] {
  return pageNumbers.map((pageNumber) => ({
    pageNumber,
    contentType: "image/png" as const,
    bytes: Buffer.from("png"),
  }));
}

function secondPass(
  textPages: readonly ExtractedPdfPage[],
  analyzed: DocumentAnalysis,
  responses: {
    render?: (pages: readonly number[]) => Promise<DocumentPageImage[]>;
    analyze?: (images: readonly DocumentPageImage[]) => Promise<DocumentAnalysis>;
  } = {},
): { calls: Calls; run: () => Promise<DocumentAnalysis> } {
  const calls: Calls = { rendered: [], analyzed: [] };
  return {
    calls,
    run: () =>
      readImagePages({
        analyzed,
        pages: textPages,
        bytes: Uint8Array.from([1, 2, 3]),
        render: async (_bytes, options) => {
          const requested = [...(options.pages ?? [])];
          calls.rendered.push(requested);
          return responses.render?.(requested) ?? pageImages(requested);
        },
        analyze: async (images) => {
          calls.analyzed.push(images.map((image) => image.pageNumber));
          if (responses.analyze === undefined) throw new Error("no vision answer scripted");
          return responses.analyze(images);
        },
      }),
  };
}

const readAndPicture = [pdfPage(1, "read"), pdfPage(2, "picture")] as const;

function textAnalysis(): DocumentAnalysis {
  return analysis({
    pages: [parsedPage(readAndPicture[0], "pdf_text_layer")],
    facts: [fact("synthetic-analyte-a", 1, "7.0")],
    results: [measurement("synthetic-analyte-a", 1, "7.0")],
  });
}

test("a picture page is read by a second pass and joins the same analysis", async () => {
  const text = textAnalysis();
  const pass = secondPass(readAndPicture, text, {
    analyze: async () =>
      analysis({
        pages: [parsedPage(readAndPicture[1], "codex_vision", "ПРОТЕИНОГРАММА\nАльбумин 55.0 %")],
        facts: [fact("synthetic-albumin", 2, "55.0")],
        results: [measurement("synthetic-albumin", 2, "55.0")],
        title: "Протеинограмма",
      }),
  });

  const merged = await pass.run();

  assert.deepEqual(pass.calls, { rendered: [[2]], analyzed: [[2]] });
  assert.deepEqual(
    merged.pages.map((page) => [page.pageNumber, page.extractionMethod]),
    [
      [1, "pdf_text_layer"],
      [2, "codex_vision"],
    ],
  );
  assert.equal(merged.pages[1]?.text, "ПРОТЕИНОГРАММА\nАльбумин 55.0 %");
  assert.deepEqual(
    merged.extraction.items.map((item) => item.factKey),
    ["synthetic-analyte-a", "synthetic-albumin"],
  );
  assert.deepEqual(
    merged.intelligence.structuredResults.map((result) => result.resultKey),
    ["synthetic-analyte-a", "synthetic-albumin"],
  );
  // The document keeps the text pass's own reading of itself; the picture page only adds.
  assert.equal(merged.intelligence.title, "Синтетические анализы");
  assert.equal(merged.unreadPages, undefined);
});

test("a page the text pass already produced a fact on is never sent to the second pass", async () => {
  const text = analysis({
    pages: [parsedPage(readAndPicture[1], "pdf_text_layer")],
    facts: [fact("synthetic-albumin", 2, "55.0")],
  });
  const pass = secondPass(readAndPicture, text);

  assert.equal(await pass.run(), text);
  assert.deepEqual(pass.calls, { rendered: [], analyzed: [] });
});

test("a page whose only evidence is a structured result is never sent either", async () => {
  const text = analysis({
    pages: [parsedPage(readAndPicture[1], "pdf_text_layer")],
    facts: [],
    results: [measurement("synthetic-albumin", 2, "55.0")],
  });
  const pass = secondPass([readAndPicture[1]], text);

  assert.equal(await pass.run(), text);
  assert.deepEqual(pass.calls, { rendered: [], analyzed: [] });
});

test("no picture page means no second run at all", async () => {
  const text = textAnalysis();
  const pass = secondPass([pdfPage(1, "read"), pdfPage(2, "read")], text);

  // A silent second run would spend one more Codex call on every ordinary document.
  assert.equal(await pass.run(), text);
  assert.deepEqual(pass.calls, { rendered: [], analyzed: [] });
});

test("a key repeated across the two passes is settled without touching a fragment", async () => {
  const repeated = fact("synthetic-analyte-a", 2, "55.0");
  const pass = secondPass(readAndPicture, textAnalysis(), {
    analyze: async () =>
      analysis({
        pages: [parsedPage(readAndPicture[1], "codex_vision")],
        facts: [repeated],
        results: [measurement("synthetic-analyte-a", 2, "55.0")],
      }),
  });

  const merged = await pass.run();

  assert.deepEqual(
    merged.extraction.items.map((item) => [item.factKey, item.sourceValue]),
    [
      ["synthetic-analyte-a", "7.0"],
      ["synthetic-analyte-a-2", "55.0"],
    ],
  );
  // A vision result bound to the renamed fact follows it, so the two stay joined.
  assert.deepEqual(
    merged.intelligence.structuredResults.map((result) => result.resultKey),
    ["synthetic-analyte-a", "synthetic-analyte-a-2"],
  );
  assert.deepEqual(merged.extraction.items[1]?.source, repeated.source);
});

test("a refused second pass leaves the text result and marks the page it could not read", async () => {
  const text = textAnalysis();
  const pass = secondPass(readAndPicture, text, {
    analyze: async () => {
      throw new CodexDocumentIntelligenceError("OUTPUT_INVALID");
    },
  });

  const merged = await pass.run();

  assert.deepEqual(merged.extraction.items, text.extraction.items);
  assert.deepEqual(merged.intelligence, text.intelligence);
  assert.deepEqual(merged.pages, text.pages);
  assert.deepEqual(merged.unreadPages, [{ pageNumber: 2, reason: "vision_unavailable" }]);
});

test("a failed render marks every candidate page instead of failing the document", async () => {
  const pictures = [pdfPage(1, "picture"), pdfPage(2, "picture")];
  const first = pictures[0] as ExtractedPdfPage;
  const text = analysis({ pages: [parsedPage(first, "pdf_text_layer")], facts: [] });
  const pass = secondPass(pictures, text, {
    render: async () => {
      throw new DocumentImageError("IMAGE_LIMIT_EXCEEDED");
    },
  });

  const merged = await pass.run();

  assert.deepEqual(pass.calls.analyzed, []);
  assert.deepEqual(merged.unreadPages, [
    { pageNumber: 1, reason: "vision_unavailable" },
    { pageNumber: 2, reason: "vision_unavailable" },
  ]);
});

test("candidates past the page cap are marked even though the pass succeeded", async () => {
  const pictures = [1, 2, 3, 4].map((pageNumber) => pdfPage(pageNumber, "picture"));
  const text = analysis({
    pages: pictures.map((page) => parsedPage(page, "pdf_text_layer")),
    facts: [],
  });
  const pass = secondPass(pictures, text, {
    // The renderer carries the first pages only and reports the rest by leaving them out.
    render: async (pages) => pageImages(pages.slice(0, 3)),
    analyze: async (images) =>
      analysis({
        pages: images.map((image) => parsedPage(pdfPage(image.pageNumber, "picture"), "vision")),
        facts: images.map((image) => fact(`synthetic-p${image.pageNumber}`, image.pageNumber, "1")),
      }),
  });

  const merged = await pass.run();

  assert.deepEqual(pass.calls.rendered, [[1, 2, 3, 4]]);
  assert.deepEqual(pass.calls.analyzed, [[1, 2, 3]]);
  assert.equal(merged.extraction.items.length, 3);
  assert.deepEqual(merged.unreadPages, [{ pageNumber: 4, reason: "image_page_limit" }]);
});

test("two passes that together outgrow one analysis keep the text pass whole", async () => {
  const text = analysis({
    pages: [parsedPage(readAndPicture[0], "pdf_text_layer")],
    facts: Array.from({ length: limits.facts }, (_, index) => fact(`synthetic-${index}`, 1, "1.0")),
  });
  const pass = secondPass(readAndPicture, text, {
    analyze: async () =>
      analysis({
        pages: [parsedPage(readAndPicture[1], "codex_vision")],
        facts: [fact("synthetic-albumin", 2, "55.0")],
      }),
  });

  const merged = await pass.run();

  assert.equal(merged.extraction.items.length, limits.facts);
  assert.deepEqual(merged.pages, text.pages);
  assert.deepEqual(merged.unreadPages, [{ pageNumber: 2, reason: "vision_unavailable" }]);
});

test("an interruption is not a second-pass failure and reaches the caller", async () => {
  const pass = secondPass([pdfPage(1, "picture")], analysis({ pages: [], facts: [] }), {
    analyze: async () => {
      throw new Error("Codex execution aborted");
    },
  });

  await assert.rejects(pass.run(), /aborted/);
});
