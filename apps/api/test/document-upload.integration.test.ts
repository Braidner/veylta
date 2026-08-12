import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type DemoRegistrationResponse,
  DOCUMENT_CONTRACT_VERSION,
  MAX_SYNTHETIC_PDF_BYTES,
} from "@veylta/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database, isSqliteConstraintError } from "../src/database/pool.js";
import { createDocumentService } from "../src/documents/document-service.js";
import { registerDocumentRoutes } from "../src/documents/routes.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import type { ObjectStorage, ObjectStorageKey } from "../src/storage/object-storage.js";

const webOrigin = "http://127.0.0.1:4300";

interface Identity {
  body: DemoRegistrationResponse;
  cookie: string;
}

interface MultipartOptions {
  contentType?: string;
  extraField?: boolean;
  filename?: string;
  secondFile?: boolean;
  uppercaseScope?: boolean;
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
  options: MultipartOptions = {},
): { body: Buffer; contentType: string } {
  const boundary = `veylta-${randomUUID()}`;
  const filename = options.filename ?? "synthetic-result.pdf";
  const contentType = options.contentType ?? "application/pdf";
  const chunks = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from("\r\n"),
  ];
  if (options.extraField === true) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="unexpected"\r\n\r\nvalue\r\n`,
      ),
    );
  }
  if (options.secondFile === true) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="second.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-second\r\n`,
      ),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function multipartWithoutFile(): { body: Buffer; contentType: string } {
  const boundary = `veylta-${randomUUID()}`;
  return {
    body: Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="unexpected"\r\n\r\nvalue\r\n--${boundary}--\r\n`,
    ),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function syntheticPdf(label: string, minimumBytes = 0): Buffer {
  const source = `%PDF-1.7\n% VEYLTA SYNTHETIC ONLY\n${label}\n%%EOF\n`;
  return Buffer.from(source.padEnd(minimumBytes, "S"));
}

function createTestApp(
  database: Database,
  storageRoot: string,
  maxPdfBytes = MAX_SYNTHETIC_PDF_BYTES,
  storage: ObjectStorage = createLocalObjectStorage(storageRoot),
) {
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
    createDocumentService(database, storage, { maxPdfBytes }),
    { allowedMutationOrigins: [webOrigin], maxPdfBytes },
  );
  return app;
}

function replaceObjectOnFirstGet(storageRoot: string): ObjectStorage {
  const delegate = createLocalObjectStorage(storageRoot);
  let armed = true;
  return {
    contractVersion: delegate.contractVersion,
    putStaging: (request) => delegate.putStaging(request),
    finalize: (stagingKey, finalKey) => delegate.finalize(stagingKey, finalKey),
    stat: (key) => delegate.stat(key),
    exists: (key) => delegate.exists(key),
    deleteStaging: (key) => delegate.deleteStaging(key),
    deleteForRecovery: (key, request) => delegate.deleteForRecovery(key, request),
    async get(key: ObjectStorageKey, expected) {
      if (armed) {
        armed = false;
        const digest = createHash("sha256").update(key).digest("hex");
        const container = join(storageRoot, "objects", digest.slice(0, 2), digest);
        const payloadPath = join(container, "payload");
        const metadataPath = join(container, "metadata.json");
        const replacement = Buffer.from(await readFile(payloadPath));
        const mutationIndex = replacement.byteLength - 2;
        const originalByte = replacement[mutationIndex];
        if (originalByte === undefined) throw new Error("Expected a non-empty synthetic PDF");
        replacement[mutationIndex] = originalByte ^ 1;
        const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
          sha256: string;
        };
        metadata.sha256 = createHash("sha256").update(replacement).digest("hex");
        await writeFile(payloadPath, replacement, { mode: 0o600 });
        await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
      }
      return delegate.get(key, expected);
    },
  };
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
  options: MultipartOptions = {},
): Promise<LightMyRequestResponse> {
  const multipart = multipartFile(bytes, options);
  const familyId = options.uppercaseScope
    ? identity.body.family.id.toUpperCase()
    : identity.body.family.id;
  const profileId = options.uppercaseScope
    ? identity.body.profile.id.toUpperCase()
    : identity.body.profile.id;
  return app.inject({
    method: "POST",
    url: `/v1/families/${familyId}/profiles/${profileId}/documents`,
    headers: {
      "content-type": multipart.contentType,
      "idempotency-key": idempotencyKey.padEnd(16, "_"),
      cookie: identity.cookie,
      origin: webOrigin,
    },
    payload: multipart.body,
  });
}

async function rowCounts(database: Database): Promise<Record<string, number>> {
  const result = await database.query<{
    blobs: number;
    documents: number;
    requests: number;
    versions: number;
  }>(
    `SELECT
       (SELECT count(*) FROM document_blobs) AS blobs,
       (SELECT count(*) FROM documents) AS documents,
       (SELECT count(*) FROM document_upload_requests) AS requests,
       (SELECT count(*) FROM document_versions) AS versions`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Expected document row counts");
  return row;
}

async function withTestContext(
  operation: (context: {
    app: FastifyInstance;
    database: Database;
    storageRoot: string;
  }) => Promise<void>,
  maxPdfBytes = MAX_SYNTHETIC_PDF_BYTES,
  storageFactory: (root: string) => ObjectStorage = createLocalObjectStorage,
): Promise<void> {
  const testRoot = await mkdtemp(join(tmpdir(), "veylta-upload-"));
  const storageRoot = join(testRoot, "storage");
  const database = createDatabase(join(testRoot, "test.sqlite"));
  await migrateUp(database);
  const app = createTestApp(database, storageRoot, maxPdfBytes, storageFactory(storageRoot));
  try {
    await operation({ app, database, storageRoot });
  } finally {
    await app.close();
    await database.close();
    await rm(testRoot, { force: true, recursive: true });
  }
}

test("upload, replay, same-family deduplication, download, and restart stay consistent", async () => {
  await withTestContext(async ({ app, database, storageRoot }) => {
    const owner = await registerOwner(app, "Upload");
    const pdf = syntheticPdf("SYNTHETIC_UPLOAD_A");
    const first = await upload(app, owner, pdf, "upload-first");
    assert.equal(first.statusCode, 202);
    assert.deepEqual(first.json().document.duplicate, {
      possible: false,
      documentId: null,
      profileId: null,
    });
    assert.equal(first.json().contractVersion, DOCUMENT_CONTRACT_VERSION);
    assert.equal(first.json().document.familyId, owner.body.family.id);
    assert.equal(first.json().document.profileId, owner.body.profile.id);
    assert.equal(first.json().document.originalFilename, "synthetic-result.pdf");
    assert.equal(first.json().document.byteSize, pdf.byteLength);
    assert.match(first.json().document.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(first.json().document.processing, { state: "not_started" });

    const replay = await upload(app, owner, pdf, "upload-first");
    assert.equal(replay.statusCode, 202);
    assert.equal(replay.json().document.id, first.json().document.id);
    assert.deepEqual(await rowCounts(database), {
      blobs: 1,
      documents: 1,
      requests: 1,
      versions: 1,
    });

    const duplicate = await upload(app, owner, pdf, "upload-duplicate");
    assert.equal(duplicate.statusCode, 202);
    assert.notEqual(duplicate.json().document.id, first.json().document.id);
    assert.deepEqual(duplicate.json().document.duplicate, {
      possible: true,
      documentId: first.json().document.id,
      profileId: owner.body.profile.id,
    });
    assert.deepEqual(await rowCounts(database), {
      blobs: 1,
      documents: 2,
      requests: 2,
      versions: 2,
    });

    const documentUrl = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${first.json().document.id}`;
    const metadata = await app.inject({
      method: "GET",
      url: documentUrl,
      headers: { cookie: owner.cookie },
    });
    assert.equal(metadata.statusCode, 200);
    assert.deepEqual(metadata.json(), first.json());

    const content = await app.inject({
      method: "GET",
      url: `${documentUrl}/content`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(content.statusCode, 200);
    assert.deepEqual(content.rawPayload, pdf);
    assert.equal(content.headers["content-type"], "application/pdf");
    assert.equal(content.headers["content-disposition"], 'attachment; filename="document.pdf"');
    assert.equal(content.headers["x-content-type-options"], "nosniff");
    assert.equal(content.headers["cache-control"], "private, no-store");
    assert.equal(content.headers["content-security-policy"], "sandbox");

    const restartedApp = createTestApp(database, storageRoot);
    try {
      const afterRestart = await restartedApp.inject({
        method: "GET",
        url: `${documentUrl}/content`,
        headers: { cookie: owner.cookie },
      });
      assert.equal(afterRestart.statusCode, 200);
      assert.deepEqual(afterRestart.rawPayload, pdf);
    } finally {
      await restartedApp.close();
    }

    const audit = await database.query<{ action: string; metadata: unknown }>(
      `SELECT action, metadata
       FROM audit_events
       WHERE resource_id = $1
       ORDER BY created_at`,
      [first.json().document.id],
    );
    assert.deepEqual(
      audit.rows.map(({ action }) => action).sort(),
      [
        "document.content.opened",
        "document.content.opened",
        "document.metadata.opened",
        "document.upload.received",
        "document.upload.replayed",
      ].sort(),
    );
    const auditText = JSON.stringify(audit.rows);
    assert.equal(auditText.includes("SYNTHETIC_UPLOAD_A"), false);
    assert.equal(auditText.includes("synthetic-result.pdf"), false);
    assert.equal(auditText.includes(first.json().document.sha256), false);
    assert.equal(auditText.includes(storageRoot), false);
  });
});

test("download rejects a self-consistent object that no longer matches database provenance", async () => {
  await withTestContext(
    async ({ app, database }) => {
      const owner = await registerOwner(app, "Read Integrity");
      const pdf = syntheticPdf("READ_PROVENANCE_BOUNDARY");
      const uploaded = await upload(app, owner, pdf, "read-integrity");
      assert.equal(uploaded.statusCode, 202);

      const response = await app.inject({
        method: "GET",
        url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${uploaded.json().document.id}/content`,
        headers: { cookie: owner.cookie },
      });

      assert.equal(response.statusCode, 500);
      assert.equal(response.json().error.code, "INTERNAL_ERROR");
      assert.equal(response.rawPayload.includes(pdf), false);
      const accessAudit = await database.query<{ count: number }>(
        `SELECT count(*) AS count
         FROM audit_events
         WHERE resource_id = $1 AND action = 'document.content.opened'`,
        [uploaded.json().document.id],
      );
      assert.equal(accessAudit.rows[0]?.count, 0);
    },
    MAX_SYNTHETIC_PDF_BYTES,
    replaceObjectOnFirstGet,
  );
});

test("upload validation rejects bad type, signature, size, and multipart shape without rows", async () => {
  await withTestContext(async ({ app, database }) => {
    const owner = await registerOwner(app, "Validation");
    const uppercaseScope = await upload(
      app,
      owner,
      syntheticPdf("UPPERCASE_SCOPE"),
      "uppercase-scope",
      { uppercaseScope: true },
    );
    assert.equal(uppercaseScope.statusCode, 400);
    assert.equal(uppercaseScope.json().error.code, "VALIDATION_ERROR");

    const urnMultipart = multipartFile(syntheticPdf("URN_SCOPE"));
    const urnScope = await app.inject({
      method: "POST",
      url: `/v1/families/${encodeURIComponent(`urn:uuid:${owner.body.family.id}`)}/profiles/${owner.body.profile.id}/documents`,
      headers: {
        "content-type": urnMultipart.contentType,
        "idempotency-key": "urn-scope-command",
        cookie: owner.cookie,
        origin: webOrigin,
      },
      payload: urnMultipart.body,
    });
    assert.equal(urnScope.statusCode, 400);
    assert.equal(urnScope.json().error.code, "VALIDATION_ERROR");

    const badType = await upload(app, owner, syntheticPdf("BAD_TYPE"), "bad-type", {
      contentType: "text/plain",
    });
    assert.equal(badType.statusCode, 415);
    assert.equal(badType.json().error.code, "UNSUPPORTED_DOCUMENT_TYPE");

    const badSignature = await upload(app, owner, Buffer.from("NOT A PDF"), "bad-signature");
    assert.equal(badSignature.statusCode, 415);
    assert.equal(badSignature.json().error.code, "INVALID_PDF_SIGNATURE");

    const wrongMediaType = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents`,
      headers: {
        "content-type": "application/pdf",
        "idempotency-key": "wrong-request-media-type",
        cookie: owner.cookie,
        origin: webOrigin,
      },
      payload: syntheticPdf("WRONG_REQUEST_MEDIA_TYPE"),
    });
    assert.equal(wrongMediaType.statusCode, 415);
    assert.equal(wrongMediaType.json().error.code, "UNSUPPORTED_MEDIA_TYPE");

    const malformedMultipart = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents`,
      headers: {
        "content-type": "multipart/form-data; boundary=missing-closing-boundary",
        "idempotency-key": "malformed-multipart-body",
        cookie: owner.cookie,
        origin: webOrigin,
      },
      payload: Buffer.from("not a multipart body"),
    });
    assert.equal(malformedMultipart.statusCode, 400);
    assert.equal(malformedMultipart.json().error.code, "INVALID_MULTIPART_UPLOAD");

    const tooLarge = await upload(app, owner, syntheticPdf("TOO_LARGE", 129), "too-large");
    assert.equal(tooLarge.statusCode, 413);
    assert.equal(tooLarge.json().error.code, "UPLOAD_TOO_LARGE");

    for (const [name, multipart] of [
      ["missing", multipartWithoutFile()],
      ["field", multipartFile(syntheticPdf("EXTRA_FIELD"), { extraField: true })],
      ["second", multipartFile(syntheticPdf("SECOND_FILE"), { secondFile: true })],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents`,
        headers: {
          "content-type": multipart.contentType,
          "idempotency-key": `multipart-${name}-command`,
          cookie: owner.cookie,
          origin: webOrigin,
        },
        payload: multipart.body,
      });
      assert.equal(response.statusCode, 400, name);
      assert.equal(response.json().error.code, "INVALID_MULTIPART_UPLOAD", name);
    }

    assert.deepEqual(await rowCounts(database), {
      blobs: 0,
      documents: 0,
      requests: 0,
      versions: 0,
    });
  }, 128);
});

test("an idempotency key cannot be reused for different bytes", async () => {
  await withTestContext(async ({ app, database }) => {
    const owner = await registerOwner(app, "Idempotency");
    const first = await upload(app, owner, syntheticPdf("REQUEST_ONE"), "same-command");
    assert.equal(first.statusCode, 202);

    const conflict = await upload(app, owner, syntheticPdf("REQUEST_TWO"), "same-command");
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, "IDEMPOTENCY_CONFLICT");
    assert.deepEqual(await rowCounts(database), {
      blobs: 1,
      documents: 1,
      requests: 1,
      versions: 1,
    });
  });
});

test("concurrent replay and same-family deduplication remain single-write", async () => {
  await withTestContext(async ({ app, database }) => {
    const owner = await registerOwner(app, "Concurrent");
    const pdf = syntheticPdf("CONCURRENT_UPLOAD");
    const [firstReplay, secondReplay] = await Promise.all([
      upload(app, owner, pdf, "concurrent-replay"),
      upload(app, owner, pdf, "concurrent-replay"),
    ]);
    assert.equal(firstReplay.statusCode, 202);
    assert.equal(secondReplay.statusCode, 202);
    assert.equal(firstReplay.json().document.id, secondReplay.json().document.id);

    const [firstDuplicate, secondDuplicate] = await Promise.all([
      upload(app, owner, pdf, "concurrent-duplicate-one"),
      upload(app, owner, pdf, "concurrent-duplicate-two"),
    ]);
    assert.equal(firstDuplicate.statusCode, 202);
    assert.equal(secondDuplicate.statusCode, 202);
    assert.notEqual(firstDuplicate.json().document.id, secondDuplicate.json().document.id);
    assert.equal(firstDuplicate.json().document.duplicate.possible, true);
    assert.equal(secondDuplicate.json().document.duplicate.possible, true);
    assert.deepEqual(await rowCounts(database), {
      blobs: 1,
      documents: 3,
      requests: 3,
      versions: 3,
    });
  });
});

test("identical bytes in another family do not disclose or share a blob", async () => {
  await withTestContext(async ({ app, database }) => {
    const firstOwner = await registerOwner(app, "First Tenant");
    const secondOwner = await registerOwner(app, "Second Tenant");
    const pdf = syntheticPdf("CROSS_FAMILY_SAME_BYTES");
    const first = await upload(app, firstOwner, pdf, "first-family");
    const second = await upload(app, secondOwner, pdf, "second-family");
    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.deepEqual(second.json().document.duplicate, {
      possible: false,
      documentId: null,
      profileId: null,
    });
    assert.deepEqual(await rowCounts(database), {
      blobs: 2,
      documents: 2,
      requests: 2,
      versions: 2,
    });

    const firstRows = await database.query<{ blob_id: string; document_id: string }>(
      `SELECT v.blob_id, v.document_id
       FROM document_versions v
       WHERE v.family_id = $1`,
      [firstOwner.body.family.id],
    );
    const secondRows = await database.query<{ blob_id: string; document_id: string }>(
      `SELECT v.blob_id, v.document_id
       FROM document_versions v
       WHERE v.family_id = $1`,
      [secondOwner.body.family.id],
    );
    const firstRow = firstRows.rows[0];
    const secondRow = secondRows.rows[0];
    if (firstRow === undefined || secondRow === undefined) {
      throw new Error("Expected one document version per test family");
    }
    await assert.rejects(
      database.query(
        `INSERT INTO document_versions
           (id, family_id, document_id, blob_id, version_number)
         VALUES ($1, $2, $3, $4, 2)`,
        [randomUUID(), firstOwner.body.family.id, firstRow.document_id, secondRow.blob_id],
      ),
      (error) => isSqliteConstraintError(error, "foreign-key"),
    );
    await assert.rejects(
      database.query(
        `UPDATE documents
         SET duplicate_of_document_id = $1
         WHERE family_id = $2 AND id = $3`,
        [secondRow.document_id, firstOwner.body.family.id, firstRow.document_id],
      ),
      (error) => isSqliteConstraintError(error, "foreign-key"),
    );

    const foreignUpload = await upload(
      app,
      secondOwner,
      syntheticPdf("FOREIGN_WRITE"),
      "foreign-write",
    );
    const foreignMultipart = multipartFile(syntheticPdf("FOREIGN_WRITE"));
    const deniedWrite = await app.inject({
      method: "POST",
      url: `/v1/families/${firstOwner.body.family.id}/profiles/${firstOwner.body.profile.id}/documents`,
      headers: {
        "content-type": foreignMultipart.contentType,
        "idempotency-key": "foreign-write-command",
        cookie: secondOwner.cookie,
        origin: webOrigin,
      },
      payload: foreignMultipart.body,
    });
    assert.equal(foreignUpload.statusCode, 202);
    assert.equal(deniedWrite.statusCode, 404);
    assert.deepEqual(await rowCounts(database), {
      blobs: 3,
      documents: 3,
      requests: 3,
      versions: 3,
    });

    const foreignBase = `/v1/families/${firstOwner.body.family.id}/profiles/${firstOwner.body.profile.id}/documents`;
    const randomBase = `/v1/families/${randomUUID()}/profiles/${randomUUID()}/documents`;
    for (const suffix of [`/${first.json().document.id}`, `/${first.json().document.id}/content`]) {
      const foreign = await app.inject({
        method: "GET",
        url: `${foreignBase}${suffix}`,
        headers: { cookie: secondOwner.cookie },
      });
      const missing = await app.inject({
        method: "GET",
        url: `${randomBase}/${randomUUID()}${suffix.endsWith("/content") ? "/content" : ""}`,
        headers: { cookie: secondOwner.cookie },
      });
      assert.equal(foreign.statusCode, 404);
      assert.equal(missing.statusCode, 404);
      assert.deepEqual(
        { code: foreign.json().error.code, message: foreign.json().error.message },
        { code: missing.json().error.code, message: missing.json().error.message },
      );
      assert.equal(foreign.body.includes("First Tenant"), false);
      assert.equal(foreign.body.includes("CROSS_FAMILY_SAME_BYTES"), false);
    }
  });
});

test("a finalized orphan is recovered by retry after a database rollback", async () => {
  await withTestContext(async ({ app, database }) => {
    const owner = await registerOwner(app, "Recovery");
    const pdf = syntheticPdf("RECOVER_FINALIZED_ORPHAN");
    await database.exec(`
      CREATE TRIGGER fail_synthetic_document_insert
      BEFORE INSERT ON documents
      BEGIN
        SELECT RAISE(ABORT, 'synthetic document insert failure');
      END;
    `);

    const failed = await upload(app, owner, pdf, "recover-command");
    assert.equal(failed.statusCode, 500);
    assert.deepEqual(await rowCounts(database), {
      blobs: 0,
      documents: 0,
      requests: 0,
      versions: 0,
    });

    await database.exec("DROP TRIGGER fail_synthetic_document_insert");
    const recovered = await upload(app, owner, pdf, "recover-command");
    assert.equal(recovered.statusCode, 202);
    assert.deepEqual(await rowCounts(database), {
      blobs: 1,
      documents: 1,
      requests: 1,
      versions: 1,
    });
  });
});
