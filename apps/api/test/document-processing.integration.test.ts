import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type DemoRegistrationResponse,
  DOCUMENT_CONTRACT_VERSION,
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  LAB_EXTRACTION_SCHEMA_VERSION,
  MAX_SYNTHETIC_PDF_BYTES,
} from "@veylta/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";
import { createDocumentService } from "../src/documents/document-service.js";
import { registerDocumentRoutes } from "../src/documents/routes.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";
import { CODEX_DOCUMENT_INTELLIGENCE_VERSION } from "../src/processing/codex-document-intelligence-provider.js";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import type { DocumentIntelligenceProvider } from "../src/processing/document-intelligence-provider.js";
import { parseSyntheticLabPages } from "../src/processing/synthetic-lab-parser.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { createObjectStorageKey } from "../src/storage/object-storage.js";
import { createSyntheticImageOnlyPdf } from "./synthetic-image-only-pdf.js";
import { createSyntheticLabImage } from "./synthetic-lab-image.js";

const webOrigin = "http://127.0.0.1:4300";
const fixtureUrl = new URL("../../../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);

interface Identity {
  body: DemoRegistrationResponse;
  cookie: string;
}

interface TestContext {
  app: FastifyInstance;
  database: Database;
  storageRoot: string;
}

function cookieFrom(response: LightMyRequestResponse): string {
  const headerValue = response.headers["set-cookie"];
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof header !== "string") throw new Error("Expected a Set-Cookie header");
  const pair = header.split(";", 1)[0];
  if (pair === undefined) throw new Error("Expected a cookie pair");
  return pair;
}

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

function createTestApp(database: Database, storageRoot: string): FastifyInstance {
  const app = buildApp({ readiness: { check: async () => undefined }, logger: false });
  const familyService = createFamilyService(database, {
    cookieName: "veylta_session",
    secureCookie: false,
    sessionTtlSeconds: 3_600,
  });
  registerFamilyRoutes(app, familyService, {
    allowedMutationOrigins: [webOrigin],
    demoRegistrationEnabled: true,
  });
  registerDocumentRoutes(
    app,
    familyService,
    createDocumentService(database, createLocalObjectStorage(storageRoot), {
      maxDocumentBytes: MAX_SYNTHETIC_PDF_BYTES,
    }),
    { allowedMutationOrigins: [webOrigin], maxDocumentBytes: MAX_SYNTHETIC_PDF_BYTES },
  );
  return app;
}

async function withTestContext(operation: (context: TestContext) => Promise<void>): Promise<void> {
  const testRoot = await mkdtemp(join(tmpdir(), "veylta-document-processing-"));
  const storageRoot = join(testRoot, "storage");
  const database = createDatabase(join(testRoot, "test.sqlite"));
  await migrateUp(database);
  const app = createTestApp(database, storageRoot);
  try {
    await operation({ app, database, storageRoot });
  } finally {
    await app.close();
    await database.close();
    await rm(testRoot, { force: true, recursive: true });
  }
}

async function registerOwner(app: FastifyInstance, suffix: string): Promise<Identity> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/demo/registrations",
    headers: { origin: webOrigin },
    payload: {
      displayName: `Synthetic Owner ${suffix}`,
      familyName: `Synthetic Family ${suffix}`,
      profileName: `Synthetic Profile ${suffix}`,
    },
  });
  assert.equal(response.statusCode, 201);
  return { body: response.json(), cookie: cookieFrom(response) };
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
): Promise<
  Awaited<ReturnType<ReturnType<typeof createDocumentExtractionProcessor>["processNext"]>>
> {
  const intelligence: DocumentIntelligenceProvider = {
    async analyze(input) {
      const pages = input.pages.map((page) => ({
        ...page,
        textSha256: createHash("sha256").update(page.text, "utf8").digest("hex"),
      }));
      let items: ReturnType<typeof parseSyntheticLabPages>["extraction"]["items"] = [];
      try {
        items = parseSyntheticLabPages(input.pages).extraction.items;
      } catch {
        // This deterministic double simulates Codex classifying a non-lab document with no facts.
      }
      return {
        pages,
        extraction: {
          schemaVersion: LAB_EXTRACTION_SCHEMA_VERSION,
          extractorVersion: CODEX_DOCUMENT_INTELLIGENCE_VERSION,
          items,
        },
        intelligence: {
          contractVersion: DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
          provider: "codex",
          modelId: "gpt-5.4-mini",
          runtimeVersion: "codex-cli/test",
          category: items.length > 0 ? "laboratory" : "other",
          title: items.length > 0 ? "Синтетические анализы" : "Синтетический документ",
          shortSummary:
            items.length > 0
              ? "Синтетические лабораторные результаты."
              : "Синтетический документ без лабораторных результатов.",
          detailedSummary:
            items.length > 0
              ? "Источник содержит только синтетические лабораторные данные для тестирования."
              : "Источник содержит только безопасные синтетические данные для тестирования.",
          structuredResults: [],
          documentDate: null,
          confidence: 0.95,
        },
      };
    },
  };
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
  await withTestContext(async ({ app, database, storageRoot }) => {
    const owner = await registerOwner(app, "Processing");
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

test("a synthetic image-only PDF uses local OCR and persists its OCR provenance", async () => {
  await withTestContext(async ({ app, database, storageRoot }) => {
    const owner = await registerOwner(app, "Scanned processing");
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
      {
        extraction_method: "local_synthetic_ocr",
        extraction_version: "pdfjs-dist/6.2.108+tesseract.js/7.0.0+eng/1.0.0",
      },
    ]);
  });
});

for (const [format, contentType, filename] of [
  ["png", "image/png", "synthetic-lab-report.png"],
  ["jpeg", "image/jpeg", "synthetic-lab-report.jpg"],
] as const) {
  test(`a direct synthetic ${format} uses local OCR with immutable image provenance`, async () => {
    await withTestContext(async ({ app, database, storageRoot }) => {
      const owner = await registerOwner(app, `Direct ${format}`);
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
        {
          extraction_method: "local_synthetic_image_ocr",
          extraction_version: "napi-rs-canvas/1.0.5+tesseract.js/7.0.0+eng/1.0.0",
        },
      ]);
    });
  });
}

test("Codex classifies an image-only PDF outside the lab grammar without inventing facts", async () => {
  await withTestContext(async ({ app, database, storageRoot }) => {
    const owner = await registerOwner(app, "Unsupported scanned processing");
    const uploaded = await upload(
      app,
      owner,
      createSyntheticImageOnlyPdf(["UNSUPPORTED EXAMPLE", "THIS IS NOT A VEYLTA SYNTHETIC REPORT"]),
      "unsupported-scanned-upload",
    );
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;

    const processed = await processOneDocument(database, storageRoot);
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
  await withTestContext(async ({ app, database, storageRoot }) => {
    const owner = await registerOwner(app, "Archive document boundary");
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
  await withTestContext(async ({ app, database, storageRoot }) => {
    const owner = await registerOwner(app, "Owner boundary");
    const outsider = await registerOwner(app, "Outsider boundary");
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
  await withTestContext(async ({ app, database, storageRoot }) => {
    const owner = await registerOwner(app, "Retry");
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

test("a trusted restart creates a fresh immutable analysis run without replacing prior results", async () => {
  await withTestContext(async ({ app, database, storageRoot }) => {
    const owner = await registerOwner(app, "Restart analysis");
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
