import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { OBJECT_STORAGE_CONTRACT_VERSION } from "@veylta/contracts";
import type { DatabaseClient, QueryResult } from "../database/pool.js";
import {
  createObjectStorageKey,
  type ObjectStorage,
  type ObjectStorageKey,
} from "../storage/object-storage.js";
import type { DocumentExtractionJobCoordinator } from "./document-extraction-processor.js";
import type { ExtractedPdfPage } from "./pdf-text-extractor.js";
import type {
  LeasedProcessingJob,
  ProcessingErrorCode,
  ProcessingExtractionOutput,
  ProcessingJob,
  ProcessingStage,
} from "./processing-job-service.js";

// One claimed job over a synthetic source: the row the processor reads, the storage it reads
// the bytes from, and a job coordinator that records what the run did instead of touching a
// database. Shared by the processor's test files. Synthetic content only.

export const now = new Date("2026-08-12T08:00:00.000Z");
export const familyId = "10000000-0000-4000-8000-000000000001";
export const documentVersionId = "10000000-0000-4000-8000-000000000002";
export const jobId = "10000000-0000-4000-8000-000000000003";
export const storageKey = createObjectStorageKey(`family_${familyId}/sha256_${"a".repeat(64)}`);
void (storageKey satisfies ObjectStorageKey);
export const pdfBytes = Buffer.from("%PDF-1.7\nsynthetic runner fixture\n%%EOF", "utf8");
export const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");

export function claim(): LeasedProcessingJob {
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

export class SourceDatabase implements DatabaseClient {
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

export function storageFor(body = pdfBytes): ObjectStorage {
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

/** One page of the synthetic fixture grammar, as a text pass would report it. */
export function syntheticPage(
  pageNumber = 1,
  factKey = "synthetic-analyte-a",
  hasRasterImage = false,
): ExtractedPdfPage {
  return {
    pageNumber,
    text: [
      "VEYLTA SYNTHETIC LAB REPORT v1",
      "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
      `FACT|${factKey}`,
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
    hasRasterImage,
  };
}

export interface CoordinatorHarness {
  released: string[];
  coordinator: DocumentExtractionJobCoordinator;
  failures: ProcessingErrorCode[];
  outputs: ProcessingExtractionOutput[];
  stages: ProcessingStage[];
}

export function coordinatorHarness(): CoordinatorHarness {
  const failures: ProcessingErrorCode[] = [];
  const outputs: ProcessingExtractionOutput[] = [];
  const stages: ProcessingStage[] = [];
  const released: string[] = [];
  const leased = claim();
  return {
    failures,
    outputs,
    stages,
    released,
    coordinator: {
      async releaseLease(claim) {
        released.push(claim.id);
      },
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
