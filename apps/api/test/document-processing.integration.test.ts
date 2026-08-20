import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DOCUMENT_CONTRACT_VERSION, LAB_EXTRACTION_SCHEMA_VERSION } from "@veylta/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { Database } from "../src/database/pool.js";
import { CODEX_DOCUMENT_INTELLIGENCE_VERSION } from "../src/processing/codex-document-intelligence-provider.js";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { createObjectStorageKey } from "../src/storage/object-storage.js";
import { withDocumentContext } from "./document-app.js";
import { type Identity, register, webOrigin } from "./family-app.js";
import { createSyntheticImageOnlyPdf } from "./synthetic-image-only-pdf.js";
import { createSyntheticIntelligence } from "./synthetic-intelligence.js";
import { createSyntheticLabImage } from "./synthetic-lab-image.js";

const fixtureUrl = new URL("../../../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);

function multipartFile(
  bytes: Buffer,
  {
    contentType = "application/pdf",
    filename = "synthetic-lab-report.pdf",
  }: {
    contentType?: string;
    filename?: string;
  } = {},
) {
  const boundary = `veylta-processing-${randomUUID()}`;
  return {
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function documentUrl(identity: Identity, documentId: string): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}/documents/${documentId}`;
}

async function upload(
  app: FastifyInstance,
  identity: Identity,
  bytes: Buffer,
  idempotencyKey: string,
  options?: { contentType?: string; filename?: string },
): Promise<LightMyRequestResponse> {
  const multipart = multipartFile(bytes, options);
  return app.inject({
    method: "POST",
    url: `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}/documents`,
    headers: {
      "content-type": multipart.contentType,
      "idempotency-key": idempotencyKey.padEnd(16, "_"),
      cookie: identity.cookie,
      origin: webOrigin,
    },
    payload: multipart.body,
  });
}

async function processOneDocument(
  database: Database,
  storageRoot: string,
  options: { visionTranscription?: string } = {},
): Promise<
  Awaited<ReturnType<ReturnType<typeof createDocumentExtractionProcessor>["processNext"]>>
> {
  const intelligence = createSyntheticIntelligence(options);
  const processor = createDocumentExtractionProcessor({
    database,
    storage: createLocalObjectStorage(storageRoot),
    intelligence,
  });
  return processor.processNext({
    workerId: `test-worker-${randomUUID()}`,
    leaseDurationMs: 60_000,
    retryDelayMs: 1,
  });
}

test("real synthetic PDF moves from a queued job to an auditable review queue", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "Processing");
    const fixture = await readFile(fixtureUrl);
    const uploaded = await upload(app, owner, fixture, "processing-fixture-upload");
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;

    const queued = await app.inject({
      method: "GET",
      url: `${documentUrl(owner, documentId)}/processing`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(queued.statusCode, 200);
    assert.equal(queued.json().contractVersion, DOCUMENT_CONTRACT_VERSION);
    assert.equal(queued.json().documentId, documentId);
    assert.equal(queued.json().processing.state, "queued");
    assert.match(queued.json().processing.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(
      queued.json().activity.map(({ code, attempt }: { code: string; attempt: number }) => ({
        code,
        attempt,
      })),
      [{ code: "queued", attempt: 0 }],
    );

    const processed = await processOneDocument(database, storageRoot);
    assert.equal(processed.status, "completed");
    if (processed.status !== "completed") throw new Error("Expected a completed extraction");
    assert.equal(processed.factCount, 2);
    assert.equal(processed.needsReviewCount, 1);

    const processing = await app.inject({
      method: "GET",
      url: `${documentUrl(owner, documentId)}/processing`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(processing.statusCode, 200);
    assert.deepEqual(
      {
        contractVersion: processing.json().contractVersion,
        documentId: processing.json().documentId,
        processing: {
          state: processing.json().processing.state,
          factCount: processing.json().processing.factCount,
          needsReviewCount: processing.json().processing.needsReviewCount,
        },
      },
      {
        contractVersion: DOCUMENT_CONTRACT_VERSION,
        documentId,
        processing: { state: "awaiting_review", factCount: 2, needsReviewCount: 1 },
      },
    );
    assert.match(processing.json().processing.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(
      processing.json().activity.map(({ code, attempt }: { code: string; attempt: number }) => ({
        code,
        attempt,
      })),
      [
        { code: "queued", attempt: 0 },
        { code: "security_check_started", attempt: 1 },
        { code: "text_extraction_started", attempt: 1 },
        { code: "document_classification_started", attempt: 1 },
        { code: "codex_analysis_started", attempt: 1 },
        { code: "result_validation_started", attempt: 1 },
        { code: "result_saved", attempt: 1 },
      ],
    );

    const facts = await app.inject({
      method: "GET",
      url: `${documentUrl(owner, documentId)}/facts`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(facts.statusCode, 200);
    assert.equal(facts.json().schemaVersion, LAB_EXTRACTION_SCHEMA_VERSION);
    assert.equal(facts.json().extractorVersion, CODEX_DOCUMENT_INTELLIGENCE_VERSION);
    assert.equal(facts.json().items.length, 2);
    assert.deepEqual(
      facts.json().items.map((item: { factKey: string }) => item.factKey),
      ["synthetic-analyte-a", "synthetic-analyte-b"],
    );
    const needsReview = facts
      .json()
      .items.find((item: { factKey: string }) => item.factKey === "synthetic-analyte-a") as
      | {
          confidence: number;
          reviewStatus: string;
          source: { documentVersionId: string; fragment: string; pageNumber: number };
          validationIssues: string[];
        }
      | undefined;
    assert.deepEqual(needsReview?.validationIssues, ["AMBIGUOUS_UNIT"]);
    assert.equal(needsReview?.reviewStatus, "needs_review");
    assert.equal(needsReview?.confidence, 0.6);
    assert.equal(needsReview?.source.pageNumber, 1);
    assert.match(needsReview?.source.fragment ?? "", /^FACT\|synthetic-analyte-a/m);

    const version = await database.query<{ id: string }>(
      "SELECT id FROM document_versions WHERE document_id = $1",
      [documentId],
    );
    assert.equal(needsReview?.source.documentVersionId, version.rows[0]?.id);

    const audit = await database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata
         FROM audit_events
        WHERE resource_id = $1
          AND action IN ('document.processing.opened', 'document.facts.opened')
        ORDER BY created_at`,
      [documentId],
    );
    assert.deepEqual(
      audit.rows.map(({ action }) => action).sort(),
      ["document.facts.opened", "document.processing.opened", "document.processing.opened"].sort(),
    );
    const auditMetadata = audit.rows.map(({ metadata }) => JSON.parse(metadata));
    assert.equal(
      auditMetadata.every(
        (metadata) =>
          typeof metadata === "object" &&
          metadata !== null &&
          metadata.contractVersion === DOCUMENT_CONTRACT_VERSION &&
          Object.keys(metadata).length === 1,
      ),
      true,
    );
    const auditText = JSON.stringify(audit.rows);
    assert.equal(auditText.includes("СИНТЕТИЧЕСКИЙ АНАЛИТ"), false);
    assert.equal(auditText.includes("AMBIGUOUS_UNIT"), false);
    assert.equal(auditText.includes("synthetic-lab-report.pdf"), false);
  });
});

test("a synthetic image-only PDF is rendered to page images that Codex transcribes", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "Scanned processing");
    const uploaded = await upload(
      app,
      owner,
      createSyntheticImageOnlyPdf([
        "VEYLTA SYNTHETIC LAB REPORT v1",
        "SYNTHETIC TEST DATA - NOT FOR MEDICAL USE",
        "FACT|synthetic-analyte-a",
        "NAME|SYNTHETIC ANALYTE A",
        "VALUE|7.0",
        "UNIT|synthetic-unit",
        "RANGE|synthetic reference",
        "CONFIDENCE|0.60",
        "ISSUES|AMBIGUOUS_UNIT",
        "END",
      ]),
      "scanned-synthetic-upload",
    );
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;

    const processed = await processOneDocument(database, storageRoot);
    assert.equal(processed.status, "completed");
    assert.equal("factCount" in processed ? processed.factCount : undefined, 1);

    const facts = await app.inject({
      method: "GET",
      url: `${documentUrl(owner, documentId)}/facts`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(facts.statusCode, 200);
    assert.equal(facts.json().items.length, 1);
    assert.equal(facts.json().items[0]?.source.pageTextOrigin, "codex_vision");
    const provenance = await database.query<{
      extraction_method: string;
      extraction_version: string;
    }>(
      `SELECT p.extraction_method, p.extraction_version
         FROM document_pages p
         JOIN document_versions v ON v.family_id = p.family_id AND v.id = p.document_version_id
        WHERE v.family_id = $1 AND v.document_id = $2`,
      [owner.body.family.id, documentId],
    );
    // The page text is the model's own transcription, and provenance says so.
    assert.deepEqual(provenance.rows, [
      { extraction_method: "codex_vision", extraction_version: "gpt-5.4-mini+codex-cli/test" },
    ]);
  });
});

for (const [format, contentType, filename] of [
  ["png", "image/png", "synthetic-lab-report.png"],
  ["jpeg", "image/jpeg", "synthetic-lab-report.jpg"],
] as const) {
  test(`a direct synthetic ${format} reaches Codex as one page image with immutable provenance`, async () => {
    await withDocumentContext(async ({ app, database, storageRoot }) => {
      const owner = await register(app, `Direct ${format}`);
      const uploaded = await upload(
        app,
        owner,
        createSyntheticLabImage(
          [
            "VEYLTA SYNTHETIC LAB REPORT v1",
            "SYNTHETIC TEST DATA - NOT FOR MEDICAL USE",
            "FACT|synthetic-analyte-a",
            "NAME|SYNTHETIC ANALYTE A",
            "VALUE|7.0",
            "UNIT|synthetic-unit",
            "RANGE|synthetic reference",
            "CONFIDENCE|0.60",
            "ISSUES|AMBIGUOUS_UNIT",
            "END",
          ],
          format,
        ),
        `direct-${format}-upload`,
        { contentType, filename },
      );
      assert.equal(uploaded.statusCode, 202);
      assert.equal(uploaded.json().document.contentType, contentType);
      assert.equal(uploaded.json().document.originalFilename, filename);
      const documentId = uploaded.json().document.id as string;

      const processed = await processOneDocument(database, storageRoot);
      assert.equal(processed.status, "completed");
      assert.equal("factCount" in processed ? processed.factCount : undefined, 1);

      // The reviewer must be told the quoted page text is the model's transcription.
      const facts = await app.inject({
        method: "GET",
        url: `${documentUrl(owner, documentId)}/facts`,
        headers: { cookie: owner.cookie },
      });
      assert.equal(facts.statusCode, 200);
      assert.equal(facts.json().items[0]?.source.pageTextOrigin, "codex_vision");

      const content = await app.inject({
        method: "GET",
        url: `${documentUrl(owner, documentId)}/content`,
        headers: { cookie: owner.cookie },
      });
      assert.equal(content.statusCode, 200);
      assert.equal(content.headers["content-type"], contentType);
      assert.equal(
        content.headers["content-disposition"],
        `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
      );

      const provenance = await database.query<{
        extraction_method: string;
        extraction_version: string;
      }>(
        `SELECT p.extraction_method, p.extraction_version
           FROM document_pages p
           JOIN document_versions v ON v.family_id = p.family_id AND v.id = p.document_version_id
          WHERE v.family_id = $1 AND v.document_id = $2`,
        [owner.body.family.id, documentId],
      );
      assert.deepEqual(provenance.rows, [
        { extraction_method: "codex_vision", extraction_version: "gpt-5.4-mini+codex-cli/test" },
      ]);
    });
  });
}

test("Codex classifies an image-only PDF outside the lab grammar without inventing facts", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "Unsupported scanned processing");
    const uploaded = await upload(
      app,
      owner,
      createSyntheticImageOnlyPdf(["UNSUPPORTED EXAMPLE", "THIS IS NOT A VEYLTA SYNTHETIC REPORT"]),
      "unsupported-scanned-upload",
    );
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;

    // The model transcribes a page that is not a lab report; nothing must be invented.
    const processed = await processOneDocument(database, storageRoot, {
      visionTranscription: "UNSUPPORTED EXAMPLE\nTHIS IS NOT A VEYLTA SYNTHETIC REPORT",
    });
    assert.equal(processed.status, "completed");
    assert.equal("factCount" in processed ? processed.factCount : undefined, 0);
    const facts = await database.query<{ count: number }>(
      `SELECT count(*) AS count
         FROM extracted_facts f
         JOIN document_versions v ON v.family_id = f.family_id AND v.id = f.document_version_id
        WHERE v.family_id = $1 AND v.document_id = $2`,
      [owner.body.family.id, documentId],
    );
    assert.equal(Number(facts.rows[0]?.count), 0);
    const intelligence = await database.query<{ category: string; title: string }>(
      `SELECT category, title
         FROM document_intelligence_results i
         JOIN document_versions v
           ON v.family_id = i.family_id AND v.id = i.document_version_id
        WHERE v.family_id = $1 AND v.document_id = $2`,
      [owner.body.family.id, documentId],
    );
    assert.deepEqual(intelligence.rows, [{ category: "other", title: "Синтетический документ" }]);
  });
});

test("an archived profile hides its sources and pauses queued extraction until an owner restores it", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "Archive document boundary");
    const addedProfile = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.body.family.id}/profiles`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { displayName: "Archive companion", kind: "dependent" },
    });
    assert.equal(addedProfile.statusCode, 201);

    const uploaded = await upload(
      app,
      owner,
      await readFile(fixtureUrl),
      "archive-document-upload",
    );
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;

    const archived = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/archive`,
      headers: { cookie: owner.cookie, origin: webOrigin },
    });
    assert.equal(archived.statusCode, 200);

    const hiddenContent = await app.inject({
      method: "GET",
      url: `${documentUrl(owner, documentId)}/content`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(hiddenContent.statusCode, 404);
    assert.equal(hiddenContent.body.includes("synthetic-lab-report.pdf"), false);

    const paused = await processOneDocument(database, storageRoot);
    assert.deepEqual(paused, { status: "idle" });
    const extractedWhileArchived = await database.query<{ count: number }>(
      `SELECT count(*) AS count
         FROM extracted_facts f
         JOIN document_versions v ON v.family_id = f.family_id AND v.id = f.document_version_id
        WHERE v.document_id = $1`,
      [documentId],
    );
    assert.equal(Number(extractedWhileArchived.rows[0]?.count), 0);

    const restored = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/restore`,
      headers: { cookie: owner.cookie, origin: webOrigin },
    });
    assert.equal(restored.statusCode, 200);

    const restoredContent = await app.inject({
      method: "GET",
      url: `${documentUrl(owner, documentId)}/content`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(restoredContent.statusCode, 200);

    const processed = await processOneDocument(database, storageRoot);
    assert.equal(processed.status, "completed");
  });
});

test("processing status and extracted facts do not disclose another family document", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "Owner boundary");
    const outsider = await register(app, "Outsider boundary");
    const uploaded = await upload(
      app,
      owner,
      await readFile(fixtureUrl),
      "tenant-boundary-fixture-upload",
    );
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;
    const processed = await processOneDocument(database, storageRoot);
    assert.equal(processed.status, "completed");

    for (const suffix of ["/processing", "/facts"]) {
      const ownerResponse = await app.inject({
        method: "GET",
        url: `${documentUrl(owner, documentId)}${suffix}`,
        headers: { cookie: owner.cookie },
      });
      assert.equal(ownerResponse.statusCode, 200);
    }

    for (const suffix of ["/processing", "/facts"]) {
      const response = await app.inject({
        method: "GET",
        url: `${documentUrl(owner, documentId)}${suffix}`,
        headers: { cookie: outsider.cookie },
      });
      assert.equal(response.statusCode, 404);
      assert.equal(response.json().error.code, "RESOURCE_NOT_FOUND");
      assert.equal(response.rawPayload.includes(documentId), false);
      assert.equal(response.rawPayload.includes("СИНТЕТИЧЕСКИЙ"), false);
      assert.equal(response.rawPayload.includes("synthetic-lab-report.pdf"), false);
    }
  });
});

test("terminal processing retry requires a trusted idempotent command and is replay-safe", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "Retry");
    const fixture = await readFile(fixtureUrl);
    const uploaded = await upload(app, owner, fixture, "terminal-failure-upload");
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;

    await database.query(
      `UPDATE processing_jobs
          SET max_attempts = 1
        WHERE family_id = $1
          AND document_version_id = (
            SELECT id FROM document_versions WHERE document_id = $2
          )`,
      [owner.body.family.id, documentId],
    );
    const storage = createLocalObjectStorage(storageRoot);
    const processingJob = await database.query<{
      document_version_id: string;
      storage_key: string;
    }>(
      `SELECT j.document_version_id, b.storage_key
         FROM processing_jobs j
         JOIN document_versions v ON v.family_id = j.family_id AND v.id = j.document_version_id
         JOIN document_blobs b ON b.family_id = v.family_id AND b.id = v.blob_id
        WHERE j.family_id = $1 AND v.document_id = $2`,
      [owner.body.family.id, documentId],
    );
    const storageKey = processingJob.rows[0]?.storage_key;
    if (storageKey === undefined) throw new Error("Expected the uploaded object storage key");
    await storage.deleteForRecovery(createObjectStorageKey(storageKey), {
      intent: "repair_or_recovery",
      reason: "Synthetic terminal retry test",
    });

    const failed = await processOneDocument(database, storageRoot);
    assert.deepEqual(
      { status: failed.status, errorCode: "errorCode" in failed ? failed.errorCode : undefined },
      { status: "dead_letter", errorCode: "DOCUMENT_UNAVAILABLE" },
    );

    const failedStatus = await app.inject({
      method: "GET",
      url: `${documentUrl(owner, documentId)}/processing`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(failedStatus.statusCode, 200);
    assert.deepEqual(
      {
        state: failedStatus.json().processing.state,
        category: failedStatus.json().processing.category,
        retryAllowed: failedStatus.json().processing.retryAllowed,
      },
      { state: "failed", category: "document_unavailable", retryAllowed: true },
    );

    const noOrigin = await app.inject({
      method: "POST",
      url: `${documentUrl(owner, documentId)}/processing/retry`,
      headers: { "idempotency-key": "retry-without-origin".padEnd(16, "_") },
    });
    assert.equal(noOrigin.statusCode, 403);
    assert.equal(noOrigin.json().error.code, "ORIGIN_NOT_ALLOWED");

    const noKey = await app.inject({
      method: "POST",
      url: `${documentUrl(owner, documentId)}/processing/retry`,
      headers: { cookie: owner.cookie, origin: webOrigin },
    });
    assert.equal(noKey.statusCode, 400);
    assert.equal(noKey.json().error.code, "INVALID_IDEMPOTENCY_KEY");

    const headers = {
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": "retry-terminal-failure".padEnd(16, "_"),
    };
    const retried = await app.inject({
      method: "POST",
      url: `${documentUrl(owner, documentId)}/processing/retry`,
      headers,
    });
    assert.equal(retried.statusCode, 202);
    assert.equal(retried.json().contractVersion, DOCUMENT_CONTRACT_VERSION);
    assert.equal(retried.json().documentId, documentId);
    assert.equal(retried.json().processing.state, "queued");
    assert.match(retried.json().processing.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    const replay = await app.inject({
      method: "POST",
      url: `${documentUrl(owner, documentId)}/processing/retry`,
      headers,
    });
    assert.equal(replay.statusCode, 202);
    assert.deepEqual(replay.json(), retried.json());

    const job = await database.query<{ attempt_count: number; state: string }>(
      `SELECT attempt_count, state
         FROM processing_jobs
        WHERE family_id = $1
          AND document_version_id = (
            SELECT id FROM document_versions WHERE document_id = $2
          )`,
      [owner.body.family.id, documentId],
    );
    assert.deepEqual(job.rows, [{ state: "pending", attempt_count: 0 }]);
    const requeueAudits = await database.query<{ count: number }>(
      `SELECT count(*) AS count
         FROM audit_events
        WHERE resource_id = $1 AND action = 'document.processing.requeued'`,
      [documentId],
    );
    assert.equal(Number(requeueAudits.rows[0]?.count), 1);

    const retriedAgainFailure = await processOneDocument(database, storageRoot);
    assert.deepEqual(
      {
        status: retriedAgainFailure.status,
        errorCode: "errorCode" in retriedAgainFailure ? retriedAgainFailure.errorCode : undefined,
      },
      { status: "dead_letter", errorCode: "DOCUMENT_UNAVAILABLE" },
    );

    const secondHeaders = {
      ...headers,
      "idempotency-key": "retry-after-second-failure".padEnd(16, "_"),
    };
    const retriedAgain = await app.inject({
      method: "POST",
      url: `${documentUrl(owner, documentId)}/processing/retry`,
      headers: secondHeaders,
    });
    assert.equal(retriedAgain.statusCode, 202);
    assert.equal(retriedAgain.json().processing.state, "queued");

    const secondReplay = await app.inject({
      method: "POST",
      url: `${documentUrl(owner, documentId)}/processing/retry`,
      headers: secondHeaders,
    });
    assert.equal(secondReplay.statusCode, 202);
    assert.deepEqual(secondReplay.json(), retriedAgain.json());

    const retryRequests = await database.query<{ count: number }>(
      `SELECT count(*) AS count
         FROM processing_retry_requests
        WHERE family_id = $1
          AND document_version_id = (
            SELECT id FROM document_versions WHERE document_id = $2
          )`,
      [owner.body.family.id, documentId],
    );
    assert.equal(Number(retryRequests.rows[0]?.count), 2);
  });
});

test("an explicit run selector opens that exact run journal and refuses a foreign run", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "Run journal");
    const source = await readFile(fixtureUrl);
    const documentId = (await upload(app, owner, source, "run-journal-first")).json().document
      .id as string;
    assert.equal((await processOneDocument(database, storageRoot)).status, "completed");

    const restarted = await app.inject({
      method: "POST",
      url: `${documentUrl(owner, documentId)}/processing/restart`,
      headers: {
        cookie: owner.cookie,
        origin: webOrigin,
        "idempotency-key": "run-journal-restart".padEnd(16, "_"),
      },
    });
    assert.equal(restarted.statusCode, 202);
    assert.equal((await processOneDocument(database, storageRoot)).status, "completed");

    const otherDocumentId = (
      await upload(
        app,
        owner,
        createSyntheticLabImage(
          [
            "VEYLTA SYNTHETIC LAB REPORT v1",
            "SYNTHETIC TEST DATA - NOT FOR MEDICAL USE",
            "FACT|synthetic-analyte-a",
            "NAME|SYNTHETIC ANALYTE A",
            "VALUE|7.0",
            "UNIT|synthetic-unit",
            "RANGE|synthetic reference",
            "CONFIDENCE|0.60",
            "ISSUES|AMBIGUOUS_UNIT",
            "END",
          ],
          "png",
        ),
        "run-journal-second",
        { contentType: "image/png", filename: "synthetic-lab-report.png" },
      )
    ).json().document.id as string;
    assert.equal((await processOneDocument(database, storageRoot)).status, "completed");

    const runIds = async (id: string): Promise<string[]> =>
      (
        await database.query<{ id: string }>(
          `SELECT j.id
             FROM processing_jobs j
             JOIN document_versions v ON v.family_id = j.family_id AND v.id = j.document_version_id
            WHERE v.document_id = $1
            ORDER BY j.created_at ASC, j.id ASC`,
          [id],
        )
      ).rows.map((row) => row.id);
    const eventCount = async (runId: string): Promise<number> =>
      Number(
        (
          await database.query<{ count: number }>(
            "SELECT count(*) AS count FROM processing_job_events WHERE processing_job_id = $1",
            [runId],
          )
        ).rows[0]?.count,
      );
    const openJournal = (runId?: string): Promise<LightMyRequestResponse> =>
      app.inject({
        method: "GET",
        url: `${documentUrl(owner, documentId)}/processing${runId === undefined ? "" : `?runId=${runId}`}`,
        headers: { cookie: owner.cookie },
      });

    const [firstRunId, secondRunId] = await runIds(documentId);
    assert.ok(firstRunId !== undefined && secondRunId !== undefined);

    const latest = await openJournal();
    assert.equal(latest.statusCode, 200);
    assert.equal(latest.json().contractVersion, DOCUMENT_CONTRACT_VERSION);
    assert.equal(latest.json().activityRunId, secondRunId);
    assert.equal(latest.json().activity.length, await eventCount(secondRunId));

    assert.equal(latest.json().diagnostics.runId, secondRunId);
    assert.equal(latest.json().diagnostics.maxAttempts, 3);
    assert.ok(Array.isArray(latest.json().diagnostics.exchanges));

    const older = await openJournal(firstRunId);
    assert.equal(older.statusCode, 200);
    assert.equal(older.json().activityRunId, firstRunId);
    assert.ok(older.json().activity.length > 0);
    assert.equal(older.json().activity.length, await eventCount(firstRunId));
    assert.deepEqual(older.json().processing, latest.json().processing);

    const [foreignRunId] = await runIds(otherDocumentId);
    assert.ok(foreignRunId !== undefined);
    assert.equal((await openJournal(foreignRunId)).statusCode, 404);
    assert.equal((await openJournal(randomUUID())).statusCode, 404);
    assert.equal((await openJournal("not-a-uuid")).statusCode, 400);
  });
});

test("a trusted restart creates a fresh immutable analysis run without replacing prior results", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "Restart analysis");
    const uploaded = await upload(
      app,
      owner,
      await readFile(fixtureUrl),
      "restart-analysis-upload",
    );
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;
    assert.equal((await processOneDocument(database, storageRoot)).status, "completed");

    const noOrigin = await app.inject({
      method: "POST",
      url: `${documentUrl(owner, documentId)}/processing/restart`,
      headers: {
        cookie: owner.cookie,
        "idempotency-key": "restart-without-origin".padEnd(16, "_"),
      },
    });
    assert.equal(noOrigin.statusCode, 403);

    const headers = {
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": "restart-successful-analysis".padEnd(16, "_"),
    };
    const restarted = await app.inject({
      method: "POST",
      url: `${documentUrl(owner, documentId)}/processing/restart`,
      headers,
    });
    assert.equal(restarted.statusCode, 202);
    assert.equal(restarted.json().contractVersion, DOCUMENT_CONTRACT_VERSION);
    assert.equal(restarted.json().documentId, documentId);
    assert.equal(restarted.json().processing.state, "queued");

    const replay = await app.inject({
      method: "POST",
      url: `${documentUrl(owner, documentId)}/processing/restart`,
      headers,
    });
    assert.equal(replay.statusCode, 202);
    assert.deepEqual(replay.json(), restarted.json());

    const beforeProcessing = await database.query<{ jobs: number; results: number; runs: number }>(
      `SELECT
         (SELECT count(*)
            FROM processing_jobs j
            JOIN document_versions v ON v.family_id = j.family_id AND v.id = j.document_version_id
           WHERE v.document_id = $1) AS jobs,
         (SELECT count(*)
            FROM document_intelligence_results i
            JOIN document_versions v ON v.family_id = i.family_id AND v.id = i.document_version_id
           WHERE v.document_id = $1) AS results,
         (SELECT count(*)
            FROM extraction_runs r
            JOIN document_versions v ON v.family_id = r.family_id AND v.id = r.document_version_id
           WHERE v.document_id = $1) AS runs`,
      [documentId],
    );
    assert.deepEqual(beforeProcessing.rows, [{ jobs: 2, results: 1, runs: 1 }]);

    assert.equal((await processOneDocument(database, storageRoot)).status, "completed");
    const afterProcessing = await database.query<{
      jobs: number;
      results: number;
      runs: number;
    }>(
      `SELECT
         (SELECT count(*)
            FROM processing_jobs j
            JOIN document_versions v ON v.family_id = j.family_id AND v.id = j.document_version_id
           WHERE v.document_id = $1) AS jobs,
         (SELECT count(*)
            FROM document_intelligence_results i
            JOIN document_versions v ON v.family_id = i.family_id AND v.id = i.document_version_id
           WHERE v.document_id = $1) AS results,
         (SELECT count(*)
            FROM extraction_runs r
            JOIN document_versions v ON v.family_id = r.family_id AND v.id = r.document_version_id
           WHERE v.document_id = $1) AS runs`,
      [documentId],
    );
    assert.deepEqual(afterProcessing.rows, [{ jobs: 2, results: 2, runs: 2 }]);

    const restartAudits = await database.query<{ count: number }>(
      `SELECT count(*) AS count
         FROM audit_events
        WHERE resource_id = $1 AND action = 'document.processing.restarted'`,
      [documentId],
    );
    assert.equal(Number(restartAudits.rows[0]?.count), 1);
  });
});
