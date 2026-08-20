import assert from "node:assert/strict";
import test from "node:test";
import { createDocumentExtractionProcessor } from "./document-extraction-processor.js";
import {
  coordinatorHarness,
  jobId,
  now,
  pdfBytes,
  SourceDatabase,
  storageFor,
  syntheticPage,
} from "./document-extraction-test-support.js";
import { DocumentImageError } from "./document-images.js";
import { PdfTextExtractionError, type PdfTextExtractionOptions } from "./pdf-text-extractor.js";

test("processes one claimed document without network access or a storage/database transaction", async () => {
  const harness = coordinatorHarness();
  let receivedOptions: PdfTextExtractionOptions | undefined;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network forbidden");
  };
  try {
    const processor = createDocumentExtractionProcessor({
      database: new SourceDatabase(),
      storage: storageFor(),
      jobs: harness.coordinator,
      now: () => now,
      extractText: async (bytes, options) => {
        assert.deepEqual(Buffer.from(bytes), pdfBytes);
        receivedOptions = options;
        return [syntheticPage()];
      },
    });

    const result = await processor.processNext({
      workerId: "worker-a",
      leaseDurationMs: 60_000,
      retryDelayMs: 1_000,
    });

    assert.deepEqual(result, {
      status: "completed",
      jobId,
      extractionRunId: "run_1",
      factCount: 1,
      needsReviewCount: 1,
    });
    assert.deepEqual(harness.stages, [
      "text_extraction",
      "document_classification",
      "structured_extraction",
      "validation",
    ]);
    assert.equal(harness.outputs.length, 1);
    assert.equal(harness.failures.length, 0);
    assert.equal(receivedOptions?.maxPdfBytes, pdfBytes.byteLength);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("maps a missing text layer to a sanitized retry outcome", async () => {
  const harness = coordinatorHarness();
  const processor = createDocumentExtractionProcessor({
    database: new SourceDatabase(),
    storage: storageFor(),
    jobs: harness.coordinator,
    now: () => now,
    extractText: async () => {
      throw new PdfTextExtractionError("TEXT_LAYER_MISSING");
    },
    renderPdfImages: async () => {
      throw new DocumentImageError("IMAGE_LIMIT_EXCEEDED");
    },
  });

  const result = await processor.processNext({
    workerId: "worker-a",
    leaseDurationMs: 60_000,
    retryDelayMs: 1_000,
  });

  assert.deepEqual(result, {
    status: "retry_wait",
    jobId,
    errorCode: "EXTRACTION_FAILED",
  });
  assert.deepEqual(harness.failures, ["EXTRACTION_FAILED"]);
  assert.equal(JSON.stringify(result).includes("TEXT_LAYER_MISSING"), false);
});

test("a PDF without a text layer reaches the provider as page images", async () => {
  const harness = coordinatorHarness();
  let renderCalls = 0;
  let receivedImages = 0;
  const processor = createDocumentExtractionProcessor({
    database: new SourceDatabase(),
    storage: storageFor(),
    jobs: harness.coordinator,
    now: () => now,
    extractText: async () => {
      throw new PdfTextExtractionError("TEXT_LAYER_MISSING");
    },
    renderPdfImages: async (bytes) => {
      renderCalls += 1;
      assert.deepEqual(Buffer.from(bytes), pdfBytes);
      return [{ pageNumber: 1, contentType: "image/png", bytes: Buffer.from("png") }];
    },
    intelligence: {
      async analyze(input) {
        receivedImages = input.images?.length ?? 0;
        assert.equal(input.pages.length, 0);
        const page = { ...syntheticPage(), textSha256: "a".repeat(64) };
        return {
          pages: [page],
          extraction: {
            schemaVersion: "lab-extraction/v1",
            extractorVersion: "codex-document-intelligence/v2",
            items: [],
          },
          intelligence: {
            contractVersion: "document-intelligence/v2",
            provider: "codex",
            modelId: "gpt-5.4-mini",
            runtimeVersion: "codex-cli/test",
            category: "other",
            title: "Синтетический документ",
            shortSummary: "Синтетический документ без лабораторных результатов.",
            detailedSummary: "Источник содержит только синтетические данные.",
            structuredResults: [],
            documentDate: null,
            confidence: 0.9,
          },
        };
      },
    },
  });

  const result = await processor.processNext({
    workerId: "worker-a",
    leaseDurationMs: 60_000,
    retryDelayMs: 1_000,
  });

  assert.equal(result.status, "completed");
  assert.equal(renderCalls, 1);
  assert.equal(receivedImages, 1);
  assert.equal(harness.failures.length, 0);
});

test("does not render page images after another text-extraction failure", async () => {
  const harness = coordinatorHarness();
  let fallbackCalls = 0;
  const processor = createDocumentExtractionProcessor({
    database: new SourceDatabase(),
    storage: storageFor(),
    jobs: harness.coordinator,
    now: () => now,
    extractText: async () => {
      throw new PdfTextExtractionError("PDF_LIMIT_EXCEEDED");
    },
    renderPdfImages: async () => {
      fallbackCalls += 1;
      return [{ pageNumber: 1, contentType: "image/png", bytes: Buffer.from("png") }];
    },
  });

  const result = await processor.processNext({
    workerId: "worker-a",
    leaseDurationMs: 60_000,
    retryDelayMs: 1_000,
  });

  assert.deepEqual(result, {
    status: "retry_wait",
    jobId,
    errorCode: "EXTRACTION_FAILED",
  });
  assert.equal(fallbackCalls, 0);
});

test("rejects a storage body larger than immutable database metadata", async () => {
  const harness = coordinatorHarness();
  const processor = createDocumentExtractionProcessor({
    database: new SourceDatabase(),
    storage: storageFor(Buffer.concat([pdfBytes, Buffer.from("extra")])),
    jobs: harness.coordinator,
    now: () => now,
    extractText: async () => {
      throw new Error("must not extract unverified bytes");
    },
  });

  const result = await processor.processNext({
    workerId: "worker-a",
    leaseDurationMs: 60_000,
    retryDelayMs: 1_000,
  });

  assert.deepEqual(result, {
    status: "retry_wait",
    jobId,
    errorCode: "DOCUMENT_UNAVAILABLE",
  });
  assert.deepEqual(harness.failures, ["DOCUMENT_UNAVAILABLE"]);
});

/**
 * A worker stopped mid-run (deploy, dev reload) must hand the job back untouched: the lease
 * is released at once and the attempt is not consumed. Otherwise every restart costs the
 * document one of its three tries while its lease idles for minutes.
 */
test("an interrupted run releases its lease without consuming the attempt", async () => {
  const harness = coordinatorHarness();
  const controller = new AbortController();
  const processor = createDocumentExtractionProcessor({
    database: new SourceDatabase(),
    storage: storageFor(),
    jobs: harness.coordinator,
    now: () => now,
    extractText: async () => [syntheticPage()],
    intelligence: {
      async analyze(input) {
        // The model call is what a shutdown interrupts; abort while it is in flight.
        controller.abort();
        input.abortSignal?.throwIfAborted();
        throw new Error("unreachable");
      },
    },
  });

  const result = await processor.processNext({
    workerId: "worker-a",
    leaseDurationMs: 60_000,
    retryDelayMs: 1_000,
    abortSignal: controller.signal,
  });

  assert.deepEqual(result, { status: "interrupted", jobId: jobId });
  assert.deepEqual(harness.released, [jobId]);
  assert.deepEqual(harness.failures, []);
});
