import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  LAB_EXTRACTION_SCHEMA_VERSION,
} from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import type { Database } from "../src/database/pool.js";
import {
  CODEX_DOCUMENT_INTELLIGENCE_VERSION,
  CodexDocumentIntelligenceError,
} from "../src/processing/codex-document-intelligence-provider.js";
import {
  createDocumentExtractionProcessor,
  type DocumentExtractionProcessorDependencies,
} from "../src/processing/document-extraction-processor.js";
import type {
  DocumentIntelligenceInput,
  DocumentIntelligenceProvider,
} from "../src/processing/document-intelligence-provider.js";
import { extractPdfTextLayer } from "../src/processing/pdf-text-extractor.js";
import type { StrictLabExtractionFact } from "../src/processing/synthetic-lab-parser.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { type Identity, webOrigin } from "./family-app.js";
import { SYNTHETIC_VISION_TRANSCRIPTION } from "./synthetic-intelligence.js";

export const imagePageFixtureUrl = new URL(
  "../../../fixtures/veylta-synthetic-image-page-report.pdf",
  import.meta.url,
);

function fact(factKey: string, pageNumber: number, fragment: string): StrictLabExtractionFact {
  return {
    factKey,
    sourceName: "СИНТЕТИЧЕСКИЙ АНАЛИТ",
    sourceValue: "7.0",
    sourceUnit: "synthetic-unit",
    proposedCanonicalCode: null,
    proposedNormalizedValue: null,
    proposedNormalizedUnit: null,
    proposedSampledAt: null,
    proposedResultedAt: null,
    proposedSpecimenType: null,
    proposedLaboratory: null,
    referenceRange: null,
    confidence: 0.9,
    validationIssues: [],
    source: { pageNumber, fragment },
  };
}

/**
 * A scripted stand-in for Codex over the image-page fixture: the text pass reports the facts
 * printed on the pages it was given, the image pass transcribes each attached page and reports
 * the fact printed in that transcription. Both bind their fragments to real lines, so the run
 * meets the same verification a live answer does.
 */
export function scriptedIntelligence(
  options: {
    refuseVision?: boolean;
    /** A line the text pass reads as a fact wherever it is printed — a caption on a picture page. */
    textFactLine?: string;
  } = {},
): {
  calls: Array<"text" | "vision">;
  provider: DocumentIntelligenceProvider;
} {
  const calls: Array<"text" | "vision">[number][] = [];
  const analyze = async (input: DocumentIntelligenceInput) => {
    const images = input.images ?? [];
    calls.push(images.length > 0 ? "vision" : "text");
    if (images.length > 0 && options.refuseVision === true) {
      throw new CodexDocumentIntelligenceError("OUTPUT_INVALID");
    }
    const pages = (
      images.length > 0
        ? images.map((image) => ({
            pageNumber: image.pageNumber,
            text: SYNTHETIC_VISION_TRANSCRIPTION,
            extractionMethod: "codex_vision",
            extractionVersion: "gpt-5.4-mini+codex-cli/test",
          }))
        : input.pages
    ).map((page) => ({
      ...page,
      textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
    }));
    const caption = options.textFactLine;
    const items = pages.flatMap((page) => {
      const lines = page.text.split("\n");
      const printed = lines
        .filter((line) => line.startsWith("FACT|"))
        .map((line) => fact(line.slice("FACT|".length), page.pageNumber, line));
      if (images.length > 0 || caption === undefined || !lines.includes(caption)) return printed;
      return [...printed, fact(`caption-page-${page.pageNumber}`, page.pageNumber, caption)];
    });
    return {
      pages,
      extraction: {
        schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
        extractorVersion: CODEX_DOCUMENT_INTELLIGENCE_VERSION,
        items,
      },
      intelligence: {
        contractVersion: DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
        provider: "codex" as const,
        modelId: "gpt-5.4-mini",
        runtimeVersion: "codex-cli/test",
        category: "laboratory" as const,
        title: images.length > 0 ? "Синтетическая денситограмма" : "Синтетические анализы",
        shortSummary: "Синтетические лабораторные результаты.",
        detailedSummary: "Источник содержит только синтетические данные для тестирования.",
        structuredResults: [],
        documentDate: null,
        confidence: 0.9,
      },
    };
  };
  return { calls, provider: { analyze } };
}

/**
 * The text pass as Veylta ran it before it could see a picture: every page reports no raster
 * image, so `imageOnlyPages` names none and no second pass follows. It is how the documents
 * already in a household's database were read.
 */
export const blindToPictures: NonNullable<
  DocumentExtractionProcessorDependencies["extractText"]
> = async (bytes, extractOptions) =>
  (await extractPdfTextLayer(bytes, extractOptions)).map((page) => ({
    ...page,
    hasRasterImage: false,
  }));

export async function processOne(
  database: Database,
  storageRoot: string,
  intelligence: DocumentIntelligenceProvider,
  overrides: Pick<DocumentExtractionProcessorDependencies, "extractText"> = {},
): Promise<{ factCount: number; status: string }> {
  const processed = await createDocumentExtractionProcessor({
    database,
    storage: createLocalObjectStorage(storageRoot),
    intelligence,
    ...(overrides.extractText === undefined ? {} : { extractText: overrides.extractText }),
  }).processNext({
    workerId: `worker-${randomUUID()}`,
    leaseDurationMs: 60_000,
    retryDelayMs: 1,
  });
  return {
    status: processed.status,
    factCount: processed.status === "completed" ? processed.factCount : 0,
  };
}

/** Asks for a fresh analysis of the same document version, the way the document page does. */
export async function restartAnalysis(
  app: FastifyInstance,
  owner: Identity,
  documentId: string,
  idempotencyKey: string,
): Promise<void> {
  const restarted = await app.inject({
    method: "POST",
    url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}/processing/restart`,
    headers: {
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": idempotencyKey.padEnd(16, "_"),
    },
  });
  assert.equal(restarted.statusCode, 202, restarted.rawPayload.toString());
}

export interface StoredPage {
  extracted_text: string;
  extraction_method: string;
  page_number: number;
  unread_reason: string | null;
}

export async function pageProvenance(
  database: Database,
  owner: Identity,
  documentId: string,
): Promise<StoredPage[]> {
  const rows = await database.query<StoredPage>(
    `SELECT p.page_number, p.extraction_method, p.extracted_text, p.unread_reason
       FROM document_pages p
       JOIN document_versions v ON v.family_id = p.family_id AND v.id = p.document_version_id
      WHERE v.family_id = $1 AND v.document_id = $2
      ORDER BY p.page_number`,
    [owner.body.family.id, documentId],
  );
  return rows.rows;
}
