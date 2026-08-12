import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type DemoRegistrationResponse,
  DOCUMENT_CONTRACT_VERSION,
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
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { createObjectStorageKey } from "../src/storage/object-storage.js";

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

function multipartFile(bytes: Buffer, filename = "synthetic-lab-report.pdf") {
  const boundary = `veylta-processing-${randomUUID()}`;
  return {
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
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
      maxPdfBytes: MAX_SYNTHETIC_PDF_BYTES,
    }),
    { allowedMutationOrigins: [webOrigin], maxPdfBytes: MAX_SYNTHETIC_PDF_BYTES },
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
): Promise<LightMyRequestResponse> {
  const multipart = multipartFile(bytes);
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
  const processor = createDocumentExtractionProcessor({
    database,
    storage: createLocalObjectStorage(storageRoot),
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

    const facts = await app.inject({
      method: "GET",
      url: `${documentUrl(owner, documentId)}/facts`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(facts.statusCode, 200);
    assert.equal(facts.json().schemaVersion, LAB_EXTRACTION_SCHEMA_VERSION);
    assert.equal(facts.json().extractorVersion, "synthetic-lab-text/v1");
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
