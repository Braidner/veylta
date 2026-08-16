import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import test from "node:test";
import { OBJECT_STORAGE_CONTRACT_VERSION } from "@veylta/contracts";
import type { DatabaseClient, QueryResult } from "../database/pool.js";
import {
  createObjectStorageKey,
  type ObjectStorage,
  type ObjectStorageKey,
} from "../storage/object-storage.js";
import {
  createDocumentExtractionProcessor,
  type DocumentExtractionJobCoordinator,
} from "./document-extraction-processor.js";
import { DocumentImageError } from "./document-images.js";
import { PdfTextExtractionError, type PdfTextExtractionOptions } from "./pdf-text-extractor.js";
import type {
  LeasedProcessingJob,
  ProcessingErrorCode,
  ProcessingExtractionOutput,
  ProcessingJob,
  ProcessingStage,
} from "./processing-job-service.js";
import type { ExtractedPageText } from "./synthetic-lab-parser.js";

const now = new Date("2026-08-12T08:00:00.000Z");
const familyId = "10000000-0000-4000-8000-000000000001";
const documentVersionId = "10000000-0000-4000-8000-000000000002";
const jobId = "10000000-0000-4000-8000-000000000003";
const storageKey = createObjectStorageKey(`family_${familyId}/sha256_${"a".repeat(64)}`);
const pdfBytes = Buffer.from("%PDF-1.7\nsynthetic runner fixture\n%%EOF", "utf8");
const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");

function claim(): LeasedProcessingJob {
  return {
    id: jobId,
    familyId,
    documentVersionId,
    kind: "document_extraction",
    dedupeKey: `extract:${familyId}:${documentVersionId}:synthetic-lab-text/v1`,
    payloadVersion: "document-extraction-job/v1",
    state: "leased",
    currentStage: "security_check",
    attemptCount: 1,
    maxAttempts: 3,
    availableAt: now.toISOString(),
    leaseOwner: "worker-a:10000000-0000-4000-8000-000000000004",
    leaseExpiresAt: "2026-08-12T08:01:00.000Z",
    lastErrorCode: null,
    lastErrorMessage: null,
    completedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

class SourceDatabase implements DatabaseClient {
  async exec(): Promise<void> {}

  async query<Row extends object>(
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    // The worker also reads the analyte catalog before every model call; empty here.
    if (/FROM analyte_catalog/.test(sql)) return { rows: [], rowCount: 0 };
    assert.match(sql, /FROM document_versions/);
    assert.deepEqual(values, [familyId, documentVersionId]);
    const rows = [
      {
        storage_key: storageKey,
        content_type: "application/pdf",
        byte_size: pdfBytes.byteLength,
        sha256: pdfSha256,
      },
    ] as unknown as Row[];
    return { rows, rowCount: rows.length };
  }
}

function storageFor(body = pdfBytes): ObjectStorage {
  return {
    contractVersion: OBJECT_STORAGE_CONTRACT_VERSION,
    async get(key, expected) {
      assert.equal(key, storageKey);
      assert.deepEqual(expected, {
        contentType: "application/pdf",
        byteSize: pdfBytes.byteLength,
        sha256: pdfSha256,
      });
      return {
        body: Readable.from([body]),
        metadata: {
          contractVersion: OBJECT_STORAGE_CONTRACT_VERSION,
          key,
          ...expected,
        },
      };
    },
    async putStaging() {
      throw new Error("not used");
    },
    async finalize() {
      throw new Error("not used");
    },
    async stat() {
      throw new Error("not used");
    },
    async exists() {
      throw new Error("not used");
    },
    async deleteStaging() {
      throw new Error("not used");
    },
    async deleteForRecovery() {
      throw new Error("not used");
    },
  };
}

function syntheticPage(): ExtractedPageText {
  return {
    pageNumber: 1,
    text: [
      "VEYLTA SYNTHETIC LAB REPORT v1",
      "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
      "FACT|synthetic-analyte-a",
      "NAME|СИНТЕТИЧЕСКИЙ АНАЛИТ A",
      "VALUE|7.0",
      "UNIT|synthetic-unit",
      "RANGE|synthetic reference",
      "CONFIDENCE|0.60",
      "ISSUES|AMBIGUOUS_UNIT",
      "END",
    ].join("\n"),
    extractionMethod: "pdf_text_layer",
    extractionVersion: "pdfjs-dist/6.2.108",
  };
}

interface CoordinatorHarness {
  coordinator: DocumentExtractionJobCoordinator;
  failures: ProcessingErrorCode[];
  outputs: ProcessingExtractionOutput[];
  stages: ProcessingStage[];
}

function coordinatorHarness(): CoordinatorHarness {
  const failures: ProcessingErrorCode[] = [];
  const outputs: ProcessingExtractionOutput[] = [];
  const stages: ProcessingStage[] = [];
  const leased = claim();
  return {
    failures,
    outputs,
    stages,
    coordinator: {
      async claimNext() {
        return leased;
      },
      async advanceStage(_claim, stage) {
        stages.push(stage);
        return { ...leased, currentStage: stage };
      },
      async completeExtraction(_claim, output) {
        outputs.push(output);
        return {
          status: "completed",
          extractionRunId: "run_1",
          factCount: output.extraction.items.length,
          needsReviewCount: 1,
        };
      },
      async recordFailure(_claim, input) {
        failures.push(input.errorCode);
        return {
          ...leased,
          state: "retry_wait",
          currentStage: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: input.errorCode,
          lastErrorMessage: "sanitized",
        } as ProcessingJob;
      },
    },
  };
}

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

void (storageKey satisfies ObjectStorageKey);
