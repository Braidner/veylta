import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  LAB_EXTRACTION_SCHEMA_VERSION,
} from "@veylta/contracts";
import type { Database } from "../src/database/pool.js";
import {
  CODEX_DOCUMENT_INTELLIGENCE_VERSION,
  CodexDocumentIntelligenceError,
} from "../src/processing/codex-document-intelligence-provider.js";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import type {
  DocumentIntelligenceInput,
  DocumentIntelligenceProvider,
} from "../src/processing/document-intelligence-provider.js";
import type { StrictLabExtractionFact } from "../src/processing/synthetic-lab-parser.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { labReportFixtureUrl, uploadDocument, withDocumentContext } from "./document-app.js";
import { type Identity, register } from "./family-app.js";
import { SYNTHETIC_VISION_TRANSCRIPTION } from "./synthetic-intelligence.js";

const imagePageFixtureUrl = new URL(
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
function scriptedIntelligence(options: { refuseVision?: boolean } = {}): {
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
    const items = pages.flatMap((page) =>
      page.text
        .split("\n")
        .filter((line) => line.startsWith("FACT|"))
        .map((line) => fact(line.slice("FACT|".length), page.pageNumber, line)),
    );
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

async function processOne(
  database: Database,
  storageRoot: string,
  intelligence: DocumentIntelligenceProvider,
): Promise<{ factCount: number; status: string }> {
  const processed = await createDocumentExtractionProcessor({
    database,
    storage: createLocalObjectStorage(storageRoot),
    intelligence,
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

async function pageProvenance(
  database: Database,
  owner: Identity,
  documentId: string,
): Promise<Array<{ extracted_text: string; extraction_method: string; page_number: number }>> {
  const rows = await database.query<{
    extracted_text: string;
    extraction_method: string;
    page_number: number;
  }>(
    `SELECT p.page_number, p.extraction_method, p.extracted_text
       FROM document_pages p
       JOIN document_versions v ON v.family_id = p.family_id AND v.id = p.document_version_id
      WHERE v.family_id = $1 AND v.document_id = $2
      ORDER BY p.page_number`,
    [owner.body.family.id, documentId],
  );
  return rows.rows;
}

test("a picture page inside a text PDF is read by a second pass and stored as its transcription", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "ImagePage");
    const fixture = await readFile(imagePageFixtureUrl);
    const uploaded = await uploadDocument(app, owner, fixture, "image-page-upload");
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;
    const codex = scriptedIntelligence();

    const processed = await processOne(database, storageRoot, codex.provider);

    // The text pass read pages 1 and 2; only the picture page went to the second, image run.
    assert.deepEqual(codex.calls, ["text", "vision"]);
    assert.deepEqual(processed, { status: "completed", factCount: 3 });
    const pages = await pageProvenance(database, owner, documentId);
    assert.deepEqual(
      pages.map((page) => [page.page_number, page.extraction_method]),
      [
        [1, "pdf_text_layer"],
        [2, "codex_vision"],
      ],
    );
    assert.equal(pages[1]?.extracted_text, SYNTHETIC_VISION_TRANSCRIPTION);

    const facts = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}/facts`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(facts.statusCode, 200);
    // The picture page's own fact repeats a key page 1 already used; the repeat is settled
    // rather than dropped, and it cites the transcription of the page it was read from.
    assert.deepEqual(
      facts
        .json()
        .items.map((item: { factKey: string; source: { pageNumber: number } }) => [
          item.factKey,
          item.source.pageNumber,
        ]),
      [
        ["synthetic-analyte-a", 1],
        ["synthetic-analyte-b", 1],
        ["synthetic-analyte-a-2", 2],
      ],
    );
  });
});

test("a document without a picture page is analyzed exactly once", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "TextOnly");
    const fixture = await readFile(labReportFixtureUrl);
    assert.equal((await uploadDocument(app, owner, fixture, "text-only-upload")).statusCode, 202);
    const codex = scriptedIntelligence();

    const processed = await processOne(database, storageRoot, codex.provider);

    // A silent second run would spend one more Codex call on every ordinary document.
    assert.deepEqual(codex.calls, ["text"]);
    assert.equal(processed.status, "completed");
  });
});

test("a refused second pass leaves the text pass's result and its page whole", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "RefusedVision");
    const fixture = await readFile(imagePageFixtureUrl);
    const uploaded = await uploadDocument(app, owner, fixture, "refused-vision-upload");
    const documentId = uploaded.json().document.id as string;
    const codex = scriptedIntelligence({ refuseVision: true });

    const processed = await processOne(database, storageRoot, codex.provider);

    assert.deepEqual(codex.calls, ["text", "vision"]);
    assert.deepEqual(processed, { status: "completed", factCount: 2 });
    assert.deepEqual(
      (await pageProvenance(database, owner, documentId)).map((page) => page.extraction_method),
      ["pdf_text_layer", "pdf_text_layer"],
    );
  });
});
