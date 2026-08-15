import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type DemoRegistrationResponse,
  DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
  MAX_SYNTHETIC_PDF_BYTES,
} from "@veylta/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";
import { createDocumentService } from "../src/documents/document-service.js";
import { registerDocumentRoutes } from "../src/documents/routes.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { createObjectStorageKey } from "../src/storage/object-storage.js";

const webOrigin = "http://127.0.0.1:4300";

interface Identity {
  body: DemoRegistrationResponse;
  cookie: string;
}

function cookieFrom(response: LightMyRequestResponse): string {
  const value = response.headers["set-cookie"];
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== "string") throw new Error("Expected session cookie");
  const cookie = header.split(";", 1)[0];
  if (cookie === undefined) throw new Error("Expected cookie pair");
  return cookie;
}

function syntheticPdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.7\n% VEYLTA SYNTHETIC ONLY\n${label}\n%%EOF\n`);
}

function multipartFile(bytes: Buffer, filename = "synthetic-result.pdf") {
  const boundary = `veylta-${randomUUID()}`;
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
  profileId = identity.body.profile.id,
  filename = "synthetic-result.pdf",
): Promise<LightMyRequestResponse> {
  const multipart = multipartFile(bytes, filename);
  return app.inject({
    method: "POST",
    url: `/v1/families/${identity.body.family.id}/profiles/${profileId}/documents`,
    headers: {
      "content-type": multipart.contentType,
      "idempotency-key": idempotencyKey.padEnd(16, "_"),
      cookie: identity.cookie,
      origin: webOrigin,
    },
    payload: multipart.body,
  });
}

async function familyOwnerUserId(database: Database, familyId: string): Promise<string> {
  const result = await database.query<{ user_id: string }>(
    `SELECT user_id
       FROM family_memberships
      WHERE family_id = $1 AND role = 'owner' AND status = 'active'`,
    [familyId],
  );
  const userId = result.rows[0]?.user_id;
  if (userId === undefined) throw new Error("Expected active family owner");
  return userId;
}

async function withContext(
  operation: (context: {
    app: FastifyInstance;
    database: Database;
    owner: Identity;
    storageRoot: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "veylta-lifecycle-"));
  const storageRoot = join(root, "storage");
  const database = createDatabase(join(root, "test.sqlite"));
  await migrateUp(database);
  const app = createTestApp(database, storageRoot);
  try {
    await operation({ app, database, owner: await registerOwner(app, "Lifecycle"), storageRoot });
  } finally {
    await app.close();
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("lifecycle migration adds tombstones and immutable request journals and rolls back empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-lifecycle-migration-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    const applied = await migrateUp(database);
    assert.equal(applied.at(-1), "0025_run_diagnostics");
    const columns = await database.query<{ name: string }>("PRAGMA table_info(documents)");
    assert.equal(
      columns.rows.some(({ name }) => name === "deleted_at"),
      true,
    );
    assert.equal(
      columns.rows.some(({ name }) => name === "deleted_by_user_id"),
      true,
    );
    assert.equal(await migrateDown(database), "0025_run_diagnostics");
    assert.equal(await migrateDown(database), "0024_document_agent_threads");
    assert.equal(await migrateDown(database), "0023_document_lifecycle");
  } finally {
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("same-profile SHA reuses one logical document while another profile reuses only the blob", async () => {
  await withContext(async ({ app, database, owner }) => {
    const pdf = syntheticPdf("PROFILE_SCOPED_DEDUP");
    const first = await upload(app, owner, pdf, "first-upload");
    const sameProfile = await upload(app, owner, pdf, "same-profile-upload");
    assert.equal(first.statusCode, 202);
    assert.equal(first.json().disposition, "created");
    assert.equal(sameProfile.statusCode, 200);
    assert.equal(sameProfile.json().disposition, "already_exists");
    assert.equal(sameProfile.json().document.id, first.json().document.id);

    const secondProfileId = randomUUID();
    const ownerUserId = await familyOwnerUserId(database, owner.body.family.id);
    await database.query(
      `INSERT INTO patient_profiles
         (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
       VALUES ($1, $2, 'Synthetic Second Profile', 'adult', NULL, $3, $4)`,
      [secondProfileId, owner.body.family.id, ownerUserId, new Date().toISOString()],
    );
    const anotherProfile = await upload(app, owner, pdf, "another-profile-upload", secondProfileId);
    assert.equal(anotherProfile.statusCode, 202);
    assert.notEqual(anotherProfile.json().document.id, first.json().document.id);
    assert.equal(anotherProfile.json().document.duplicate.documentId, first.json().document.id);

    const counts = await database.query<{
      blobs: number;
      documents: number;
      reuse_requests: number;
      upload_requests: number;
      versions: number;
    }>(
      `SELECT
         (SELECT count(*) FROM document_blobs) AS blobs,
         (SELECT count(*) FROM documents) AS documents,
         (SELECT count(*) FROM document_upload_reuse_requests) AS reuse_requests,
         (SELECT count(*) FROM document_upload_requests) AS upload_requests,
         (SELECT count(*) FROM document_versions) AS versions`,
    );
    assert.deepEqual(counts.rows[0], {
      blobs: 1,
      documents: 2,
      reuse_requests: 1,
      upload_requests: 2,
      versions: 2,
    });
  });
});

test("original download filename is UTF-8 safe and rejects stored CRLF header injection", async () => {
  await withContext(async ({ app, database, owner }) => {
    const pdf = syntheticPdf("SAFE_FILENAME");
    const uploaded = await upload(app, owner, pdf, "safe-filename");
    const documentId = uploaded.json().document.id as string;
    await database.query("UPDATE documents SET original_filename = $1 WHERE id = $2", [
      'Анализы 2026.pdf"\r\nX-Evil: injected',
      documentId,
    ]);
    const response = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}/content`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.rawPayload, pdf);
    assert.equal(response.headers["x-evil"], undefined);
    const disposition = response.headers["content-disposition"];
    assert.equal(typeof disposition, "string");
    assert.equal(disposition?.includes("\r"), false);
    assert.equal(disposition?.includes("\n"), false);
    assert.match(disposition ?? "", /filename\*=UTF-8''%D0%90%D0%BD%D0%B0%D0%BB%D0%B8%D0%B7%D1%8B/);
  });
});

test("delete is trusted-origin idempotent, hides the document, and retains immutable bytes", async () => {
  await withContext(async ({ app, database, owner, storageRoot }) => {
    const pdf = syntheticPdf("TOMBSTONE_ONLY");
    const uploaded = await upload(app, owner, pdf, "delete-source");
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;
    const documentPath = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}`;

    const missingOrigin = await app.inject({
      method: "DELETE",
      url: documentPath,
      headers: { cookie: owner.cookie, "idempotency-key": "delete-document-1" },
    });
    assert.equal(missingOrigin.statusCode, 403);

    const deleted = await app.inject({
      method: "DELETE",
      url: documentPath,
      headers: {
        cookie: owner.cookie,
        origin: webOrigin,
        "idempotency-key": "delete-document-1",
      },
    });
    assert.equal(deleted.statusCode, 200);
    assert.equal(deleted.json().contractVersion, "document-lifecycle/v1");
    assert.equal(deleted.json().documentId, documentId);

    const replay = await app.inject({
      method: "DELETE",
      url: documentPath,
      headers: {
        cookie: owner.cookie,
        origin: webOrigin,
        "idempotency-key": "delete-document-1",
      },
    });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), deleted.json());

    for (const suffix of ["", "/content", "/processing", "/facts"] as const) {
      const hidden = await app.inject({
        method: "GET",
        url: `${documentPath}${suffix}`,
        headers: { cookie: owner.cookie },
      });
      assert.equal(hidden.statusCode, 404);
    }
    const overview = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/overview`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(overview.statusCode, 200);
    assert.deepEqual(overview.json().recentDocuments, []);

    const stored = await database.query<{
      deleted_at: string | null;
      deleted_by_user_id: string | null;
      storage_key: string;
    }>(
      `SELECT document.deleted_at, document.deleted_by_user_id, blob.storage_key
         FROM documents document
         JOIN document_versions version
           ON version.family_id = document.family_id AND version.document_id = document.id
         JOIN document_blobs blob
           ON blob.family_id = version.family_id AND blob.id = version.blob_id
        WHERE document.id = $1`,
      [documentId],
    );
    assert.match(stored.rows[0]?.deleted_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(
      stored.rows[0]?.deleted_by_user_id,
      await familyOwnerUserId(database, owner.body.family.id),
    );
    await assert.rejects(
      database.query("UPDATE documents SET deleted_at = $1 WHERE id = $2", [
        "2026-08-14T00:00:00.000Z",
        documentId,
      ]),
      /document deletion metadata is invalid or immutable/,
    );
    await assert.rejects(
      database.query("DELETE FROM documents WHERE id = $1", [documentId]),
      /documents must be tombstoned/,
    );
    const storage = createLocalObjectStorage(storageRoot);
    const storageKey = stored.rows[0]?.storage_key;
    if (storageKey === undefined) throw new Error("Expected retained storage key");
    assert.equal(await storage.exists(createObjectStorageKey(storageKey)), true);

    const replacement = await upload(app, owner, pdf, "replacement-after-delete");
    assert.equal(replacement.statusCode, 202);
    assert.notEqual(replacement.json().document.id, documentId);
    const conflictingDelete = await app.inject({
      method: "DELETE",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${replacement.json().document.id}`,
      headers: {
        cookie: owner.cookie,
        origin: webOrigin,
        "idempotency-key": "delete-document-1",
      },
    });
    assert.equal(conflictingDelete.statusCode, 409);
    assert.equal(conflictingDelete.json().error.code, "IDEMPOTENCY_CONFLICT");
    const physicalCounts = await database.query<{ blobs: number; documents: number }>(
      `SELECT (SELECT count(*) FROM document_blobs) AS blobs,
              (SELECT count(*) FROM documents) AS documents`,
    );
    assert.deepEqual(physicalCounts.rows[0], { blobs: 1, documents: 2 });

    const audits = await database.query<{ action: string; metadata: unknown }>(
      `SELECT action, metadata
         FROM audit_events
        WHERE resource_id = $1 AND action LIKE 'document.delete%'
        ORDER BY created_at`,
      [documentId],
    );
    assert.deepEqual(
      audits.rows.map(({ action }) => action),
      ["document.deleted", "document.delete.replayed"],
    );
    const auditText = JSON.stringify(audits.rows);
    assert.equal(auditText.includes("TOMBSTONE_ONLY"), false);
    assert.equal(auditText.includes("synthetic-result.pdf"), false);
    assert.equal(auditText.includes(uploaded.json().document.sha256), false);
  });
});

test("search normalizes Cyrillic, uses only latest intelligence, and audits no query payload", async () => {
  await withContext(async ({ app, database, owner }) => {
    const first = await upload(app, owner, syntheticPdf("SEARCH_FIRST"), "search-first");
    const second = await upload(app, owner, syntheticPdf("SEARCH_SECOND"), "search-second");
    const legacy = await upload(app, owner, syntheticPdf("SEARCH_LEGACY"), "search-legacy");
    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.equal(legacy.statusCode, 202);

    const insertIntelligence = async (
      documentId: string,
      title: string,
      shortSummary: string,
      detailedSummary: string,
      structuredResults: readonly unknown[],
      searchText: string,
      createdAt = "2026-08-14T12:00:00.000Z",
      schemaVersion: string = DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
    ) => {
      const graph = await database.query<{ version_id: string; job_id: string }>(
        `SELECT version.id AS version_id, job.id AS job_id
           FROM document_versions version
           JOIN processing_jobs job
             ON job.family_id = version.family_id AND job.document_version_id = version.id
          WHERE version.document_id = $1
          ORDER BY job.created_at DESC, job.id DESC
          LIMIT 1`,
        [documentId],
      );
      const row = graph.rows[0];
      if (row === undefined) throw new Error("Expected processing graph");
      await database.query(
        `INSERT INTO document_intelligence_results
           (id, family_id, document_id, document_version_id, processing_job_id,
            provider, model_id, runtime_version, schema_version, category, title,
            short_summary, detailed_summary, structured_results_json, search_text,
            document_date, confidence, created_at)
         VALUES ($1, $2, $3, $4, $5, 'codex', 'synthetic-model', 'synthetic-runtime',
                 $6, 'laboratory', $7, $8, $9, $10, $11, '2026-08-14', 0.9, $12)`,
        [
          randomUUID(),
          owner.body.family.id,
          documentId,
          row.version_id,
          row.job_id,
          schemaVersion,
          title,
          shortSummary,
          detailedSummary,
          JSON.stringify(structuredResults),
          searchText,
          createdAt,
        ],
      );
    };
    await insertIntelligence(
      first.json().document.id,
      "Синтетические анализы",
      "Кратко про витамин D",
      "Подробное синтетическое описание",
      [
        {
          resultKey: "vitamin-d",
          type: "measurement",
          label: "Витамин D",
          value: "synthetic",
          unit: null,
          code: null,
          lab: null,
          specimen: null,
          date: null,
          status: "unknown",
          confidence: 0.9,
          source: { pageNumber: 1, fragment: "SYNTHETIC VITAMIN D SOURCE" },
        },
      ],
      "синтетические анализы кратко про витамин d подробное описание витамин d synthetic",
    );
    await insertIntelligence(
      second.json().document.id,
      "Старый документ",
      "Старое упоминание витамина D",
      "Этот результат должен быть скрыт более новым анализом",
      [],
      "старый документ старое упоминание витамина d скрытый результат",
      "2026-08-14T11:00:00.000Z",
    );
    const secondVersion = await database.query<{ id: string }>(
      "SELECT id FROM document_versions WHERE document_id = $1 AND version_number = 1",
      [second.json().document.id],
    );
    const secondVersionId = secondVersion.rows[0]?.id;
    if (secondVersionId === undefined) throw new Error("Expected second document version");
    const newerJobAt = "2099-08-14T13:00:00.000Z";
    await database.query(
      `INSERT INTO processing_jobs
         (id, family_id, document_version_id, kind, dedupe_key, payload_version,
          state, attempt_count, max_attempts, available_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'document_extraction', $4, 'document-extraction-job/v1',
               'pending', 0, 3, $5, $5, $5)`,
      [
        randomUUID(),
        owner.body.family.id,
        secondVersionId,
        `lifecycle-search:${secondVersionId}`,
        newerJobAt,
      ],
    );
    await insertIntelligence(
      second.json().document.id,
      "Другой документ",
      "Без искомого показателя",
      "Только безопасные синтетические данные",
      [],
      "другой документ без искомого показателя безопасные синтетические данные",
      newerJobAt,
    );
    await insertIntelligence(
      legacy.json().document.id,
      "Старый классифицированный документ",
      "Результат предыдущей версии без краткого описания.",
      "Результат предыдущей версии не содержит подробного описания.",
      [],
      "результат предыдущей версии",
      "2026-08-14T10:00:00.000Z",
      "document-intelligence/v1",
    );

    const response = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents?q=${encodeURIComponent("  ВИТАМИН   D  ")}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.json().contractVersion, "document-search/v1");
    assert.deepEqual(
      response.json().documents.map((document: { id: string }) => document.id),
      [first.json().document.id],
    );
    assert.equal(response.json().documents[0].intelligence.shortSummary, "Кратко про витамин D");
    assert.equal("detailedSummary" in response.json().documents[0].intelligence, false);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${first.json().document.id}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(
      detail.json().document.intelligence.detailedSummary,
      "Подробное синтетическое описание",
    );
    assert.equal(detail.json().document.intelligence.structuredResults[0].resultKey, "vitamin-d");

    const legacyDetail = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${legacy.json().document.id}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(legacyDetail.statusCode, 200);
    assert.equal(
      legacyDetail.json().document.intelligence.contractVersion,
      DOCUMENT_INTELLIGENCE_CONTRACT_VERSION,
    );
    assert.deepEqual(legacyDetail.json().document.intelligence.structuredResults, []);

    const tooLong = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents?q=${"x".repeat(121)}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(tooLong.statusCode, 400);
    const unauthenticated = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents?q=витамин`,
    });
    assert.equal(unauthenticated.statusCode, 401);
    const outsider = await registerOwner(app, "Search Outsider");
    const forbidden = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents?q=витамин`,
      headers: { cookie: outsider.cookie },
    });
    const missing = await app.inject({
      method: "GET",
      url: `/v1/families/${randomUUID()}/profiles/${randomUUID()}/documents?q=витамин`,
      headers: { cookie: outsider.cookie },
    });
    assert.equal(forbidden.statusCode, 404);
    assert.deepEqual(
      {
        code: forbidden.json().error.code,
        message: forbidden.json().error.message,
      },
      { code: missing.json().error.code, message: missing.json().error.message },
    );
    assert.equal(forbidden.body.includes("Синтетические анализы"), false);

    const audits = await database.query<{ metadata: unknown }>(
      `SELECT metadata FROM audit_events WHERE action = 'profile.documents.searched'`,
    );
    assert.equal(audits.rows.length, 1);
    assert.equal(JSON.stringify(audits.rows).includes("витамин"), false);
  });
});
