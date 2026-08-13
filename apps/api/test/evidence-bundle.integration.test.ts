import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type DemoRegistrationResponse,
  MAX_SYNTHETIC_DOCUMENT_BYTES,
  MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS,
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

const webOrigin = "http://127.0.0.1:4300";
const fixtureUrl = new URL("../../../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);

interface Identity {
  body: DemoRegistrationResponse;
  cookie: string;
  userId: string;
}

interface TestContext {
  app: FastifyInstance;
  database: Database;
  storageRoot: string;
}

function cookieFrom(response: LightMyRequestResponse): string {
  const headerValue = response.headers["set-cookie"];
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof header !== "string") throw new Error("Expected a session cookie");
  const pair = header.split(";", 1)[0];
  if (pair === undefined) throw new Error("Expected a session cookie pair");
  return pair;
}

function profilePath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
}

function evidenceBundlePath(identity: Identity): string {
  return `${profilePath(identity)}/evidence-bundle`;
}

function documentPath(identity: Identity, documentId: string): string {
  return `${profilePath(identity)}/documents/${documentId}`;
}

function multipartFile(bytes: Buffer, filename: string) {
  const boundary = `veylta-evidence-${randomUUID()}`;
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
      maxDocumentBytes: MAX_SYNTHETIC_DOCUMENT_BYTES,
    }),
    { allowedMutationOrigins: [webOrigin], maxDocumentBytes: MAX_SYNTHETIC_DOCUMENT_BYTES },
  );
  return app;
}

async function withTestContext(operation: (context: TestContext) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "veylta-evidence-bundle-"));
  const database = createDatabase(join(root, "test.sqlite"));
  const storageRoot = join(root, "storage");
  await migrateUp(database);
  const app = createTestApp(database, storageRoot);
  try {
    await operation({ app, database, storageRoot });
  } finally {
    await app.close();
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
}

async function registerOwner(app: FastifyInstance, suffix: string): Promise<Identity> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/demo/registrations",
    headers: { origin: webOrigin },
    payload: {
      displayName: `Evidence owner ${suffix}`,
      familyName: `Evidence family ${suffix}`,
      profileName: `Evidence profile ${suffix}`,
    },
  });
  assert.equal(response.statusCode, 201);
  const cookie = cookieFrom(response);
  const session = await app.inject({ method: "GET", url: "/v1/session", headers: { cookie } });
  assert.equal(session.statusCode, 200);
  return { body: response.json(), cookie, userId: session.json().user.id as string };
}

async function uploadDocument(
  context: TestContext,
  owner: Identity,
  filename = "evidence-source.pdf",
): Promise<string> {
  const multipart = multipartFile(await readFile(fixtureUrl), filename);
  const uploaded = await context.app.inject({
    method: "POST",
    url: `${profilePath(owner)}/documents`,
    headers: {
      "content-type": multipart.contentType,
      "idempotency-key": `evidence_${randomUUID()}`,
      cookie: owner.cookie,
      origin: webOrigin,
    },
    payload: multipart.body,
  });
  assert.equal(uploaded.statusCode, 202);
  return uploaded.json().document.id as string;
}

async function uploadAndExtract(context: TestContext, owner: Identity): Promise<string> {
  const documentId = await uploadDocument(context, owner);
  const processor = createDocumentExtractionProcessor({
    database: context.database,
    storage: createLocalObjectStorage(context.storageRoot),
  });
  const processed = await processor.processNext({
    workerId: `evidence-worker-${randomUUID()}`,
    leaseDurationMs: 60_000,
    retryDelayMs: 1,
  });
  assert.equal(processed.status, "completed");
  return documentId;
}

async function confirmOneFact(
  context: TestContext,
  owner: Identity,
  documentId: string,
): Promise<void> {
  const facts = await context.app.inject({
    method: "GET",
    url: `${documentPath(owner, documentId)}/facts`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(facts.statusCode, 200);
  const factId = facts.json().items[0]?.id as string | undefined;
  if (factId === undefined) throw new Error("Expected an extracted fact");
  const reviewed = await context.app.inject({
    method: "POST",
    url: `${documentPath(owner, documentId)}/facts/${factId}/review`,
    headers: {
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": `evidence-review_${randomUUID()}`,
    },
    payload: { factVersion: 1, decision: "confirm" },
  });
  assert.equal(reviewed.statusCode, 201, reviewed.rawPayload.toString());
}

function tarEntries(bundle: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= bundle.length) {
    const header = bundle.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const path = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii"), 8);
    entries.set(path, bundle.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test("owner can export a bounded synthetic evidence bundle with source bytes and payload-free audit", async () => {
  await withTestContext(async (context) => {
    const owner = await registerOwner(context.app, "owner");
    const documentId = await uploadAndExtract(context, owner);

    const response = await context.app.inject({
      method: "GET",
      url: evidenceBundlePath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200, response.rawPayload.toString());
    assert.equal(response.headers["content-type"], "application/x-tar");
    assert.equal(response.headers["cache-control"], "private, no-store");
    const entries = tarEntries(response.rawPayload);
    const manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "{}") as {
      contractVersion: string;
      documents: Array<{ id: string; archivePath: string; sha256: string }>;
    };
    assert.equal(manifest.contractVersion, "synthetic-evidence-bundle/v1");
    assert.deepEqual(
      manifest.documents.map((document) => document.id),
      [documentId],
    );
    const document = manifest.documents[0];
    if (document === undefined) throw new Error("Expected exported document");
    assert.equal(entries.get(document.archivePath)?.toString("binary").startsWith("%PDF-"), true);
    assert.equal(JSON.stringify(manifest).includes("storage_key"), false);

    const audit = await context.database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata
         FROM audit_events
        WHERE family_id = $1 AND resource_id = $2 AND action = 'profile.evidence_bundle.exported'`,
      [owner.body.family.id, owner.body.profile.id],
    );
    assert.equal(audit.rows.length, 1);
    assert.deepEqual(JSON.parse(audit.rows[0]?.metadata ?? "{}"), {
      contractVersion: "synthetic-evidence-bundle/v1",
    });
    assert.equal(JSON.stringify(audit.rows).includes("evidence-source.pdf"), false);
  });
});

test("a profile.read grant cannot export a bundle", async () => {
  await withTestContext(async (context) => {
    const owner = await registerOwner(context.app, "owner grant");
    const reader = await registerOwner(context.app, "reader grant");
    await uploadAndExtract(context, owner);
    await context.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO family_memberships (family_id, user_id, role, status, created_at)
         VALUES ($1, $2, 'caregiver', 'active', $3)`,
        [owner.body.family.id, reader.userId, new Date()],
      );
      await client.query(
        `INSERT INTO profile_consent_grants
           (id, family_id, patient_profile_id, grantee_user_id, capability, granted_by_user_id, created_at)
         VALUES ($1, $2, $3, $4, 'profile.read', $5, $6)`,
        [
          randomUUID(),
          owner.body.family.id,
          owner.body.profile.id,
          reader.userId,
          owner.userId,
          new Date(),
        ],
      );
    });

    const response = await context.app.inject({
      method: "GET",
      url: evidenceBundlePath(owner),
      headers: { cookie: reader.cookie },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "RESOURCE_NOT_FOUND");
  });
});

test("the local export is a bounded snapshot when a profile has more source documents", async () => {
  await withTestContext(async (context) => {
    const owner = await registerOwner(context.app, "document bound");
    const olderDocumentId = await uploadAndExtract(context, owner);
    await confirmOneFact(context, owner, olderDocumentId);
    await context.database.query(`UPDATE documents SET uploaded_at = $1 WHERE id = $2`, [
      "2026-01-01T00:00:00.000Z",
      olderDocumentId,
    ]);
    for (let index = 1; index <= MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS; index += 1) {
      await uploadDocument(context, owner, `evidence-bound-${index}.pdf`);
    }

    const response = await context.app.inject({
      method: "GET",
      url: evidenceBundlePath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200);
    const entries = tarEntries(response.rawPayload);
    const manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "{}") as {
      documents: Array<{ archivePath: string }>;
      observations: Array<{ sourceDocument: { id: string } }>;
    };
    assert.equal(manifest.documents.length, MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS);
    assert.equal(entries.size, MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS + 1);
    assert.equal(manifest.observations.length, 0);
    assert.equal(
      manifest.documents.some((document) => document.archivePath.includes(olderDocumentId)),
      false,
    );
    const audit = await context.database.query<{ id: string }>(
      `SELECT id FROM audit_events WHERE action = 'profile.evidence_bundle.exported'`,
    );
    assert.equal(audit.rows.length, 1);
  });
});

test("another family cannot discover a synthetic evidence bundle", async () => {
  await withTestContext(async (context) => {
    const owner = await registerOwner(context.app, "owner boundary");
    const outsider = await registerOwner(context.app, "outsider boundary");
    await uploadAndExtract(context, owner);

    const response = await context.app.inject({
      method: "GET",
      url: evidenceBundlePath(owner),
      headers: { cookie: outsider.cookie },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "RESOURCE_NOT_FOUND");
    assert.equal(response.rawPayload.includes(owner.body.profile.id), false);
    assert.equal(response.rawPayload.includes("evidence-source.pdf"), false);
  });
});
