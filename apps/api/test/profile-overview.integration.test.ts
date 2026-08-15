import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type DemoRegistrationResponse,
  MAX_SYNTHETIC_DOCUMENT_BYTES,
  PROFILE_OVERVIEW_CONTRACT_VERSION,
  type ProfileOverviewResponse,
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
  if (typeof header !== "string") throw new Error("Expected a Set-Cookie header");
  const pair = header.split(";", 1)[0];
  if (pair === undefined) throw new Error("Expected a cookie pair");
  return pair;
}

function profilePath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
}

function overviewPath(identity: Identity): string {
  return `${profilePath(identity)}/overview`;
}

function multipartFile(bytes: Buffer) {
  const boundary = `veylta-overview-${randomUUID()}`;
  return {
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="overview-synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
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
  const root = await mkdtemp(join(tmpdir(), "veylta-profile-overview-"));
  const storageRoot = join(root, "storage");
  const database = createDatabase(join(root, "test.sqlite"));
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
      displayName: `Overview Owner ${suffix}`,
      familyName: `Overview Family ${suffix}`,
      profileName: `Overview Profile ${suffix}`,
    },
  });
  assert.equal(response.statusCode, 201);
  const cookie = cookieFrom(response);
  const session = await app.inject({ method: "GET", url: "/v1/session", headers: { cookie } });
  assert.equal(session.statusCode, 200);
  return { body: response.json(), cookie, userId: session.json().user.id as string };
}

async function uploadAndExtract(context: TestContext, owner: Identity): Promise<string> {
  const multipart = multipartFile(await readFile(fixtureUrl));
  const uploaded = await context.app.inject({
    method: "POST",
    url: `${profilePath(owner)}/documents`,
    headers: {
      "content-type": multipart.contentType,
      "idempotency-key": `overview_${randomUUID()}`,
      cookie: owner.cookie,
      origin: webOrigin,
    },
    payload: multipart.body,
  });
  assert.equal(uploaded.statusCode, 202);
  const documentId = uploaded.json().document.id as string;
  const processor = createDocumentExtractionProcessor({
    database: context.database,
    storage: createLocalObjectStorage(context.storageRoot),
  });
  const processed = await processor.processNext({
    workerId: `overview-worker-${randomUUID()}`,
    leaseDurationMs: 60_000,
    retryDelayMs: 1,
  });
  assert.equal(processed.status, "completed");
  return documentId;
}

test("profile overview is source-first, bounded, and payload-free audited", async () => {
  await withTestContext(async (context) => {
    const owner = await registerOwner(context.app, "Owner");
    const documentId = await uploadAndExtract(context, owner);

    const response = await context.app.inject({
      method: "GET",
      url: overviewPath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200, response.rawPayload.toString());
    assert.equal(response.headers["cache-control"], "no-store");
    const overview = response.json() as ProfileOverviewResponse;
    assert.equal(overview.contractVersion, PROFILE_OVERVIEW_CONTRACT_VERSION);
    assert.equal(overview.profile.id, owner.body.profile.id);
    assert.equal(overview.reviewQueue.documentCount, 1);
    assert.equal(overview.reviewQueue.pendingFactCount, 2);
    assert.equal(overview.reviewQueue.needsAttentionFactCount, 1);
    assert.deepEqual(
      overview.reviewQueue.documents.map((document) => ({
        id: document.id,
        originalFilename: document.originalFilename,
        contentType: document.contentType,
        pendingFactCount: document.pendingFactCount,
        needsAttentionFactCount: document.needsAttentionFactCount,
      })),
      [
        {
          id: documentId,
          originalFilename: "overview-synthetic.pdf",
          contentType: "application/pdf",
          pendingFactCount: 2,
          needsAttentionFactCount: 1,
        },
      ],
    );
    assert.equal(overview.recentDocuments.length, 1);
    assert.deepEqual(overview.recentDocuments[0], {
      id: documentId,
      originalFilename: "overview-synthetic.pdf",
      contentType: "application/pdf",
      uploadedAt: overview.recentDocuments[0]?.uploadedAt,
      processing: overview.recentDocuments[0]?.processing,
      intelligence: null,
    });
    assert.equal(overview.recentDocuments[0]?.processing.state, "awaiting_review");
    assert.deepEqual(overview.recentObservations, []);

    const audit = await context.database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata
         FROM audit_events
        WHERE family_id = $1
          AND resource_id = $2
          AND action = 'profile.overview.opened'`,
      [owner.body.family.id, owner.body.profile.id],
    );
    assert.equal(audit.rows.length, 1);
    assert.deepEqual(JSON.parse(audit.rows[0]?.metadata ?? "{}"), {
      contractVersion: PROFILE_OVERVIEW_CONTRACT_VERSION,
    });
    assert.equal(JSON.stringify(audit.rows).includes("overview-synthetic.pdf"), false);
    assert.equal(JSON.stringify(audit.rows).includes("AMBIGUOUS_UNIT"), false);
  });
});

test("profile overview is non-disclosing outside the authorized profile scope", async () => {
  await withTestContext(async (context) => {
    const owner = await registerOwner(context.app, "Owner boundary");
    const outsider = await registerOwner(context.app, "Outsider boundary");
    await uploadAndExtract(context, owner);

    const response = await context.app.inject({
      method: "GET",
      url: overviewPath(owner),
      headers: { cookie: outsider.cookie },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "RESOURCE_NOT_FOUND");
    assert.equal(response.rawPayload.includes(owner.body.profile.id), false);
    assert.equal(response.rawPayload.includes("overview-synthetic.pdf"), false);
    assert.equal(response.rawPayload.includes("AMBIGUOUS_UNIT"), false);
  });
});

test("profile overview honors a revocable profile.read grant as read-only access", async () => {
  await withTestContext(async (context) => {
    const owner = await registerOwner(context.app, "Owner grant");
    const reader = await registerOwner(context.app, "Reader grant");

    await context.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO family_memberships
           (family_id, user_id, role, status, created_at)
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
      url: overviewPath(owner),
      headers: { cookie: reader.cookie },
    });
    assert.equal(response.statusCode, 200, response.rawPayload.toString());
    const overview = response.json() as ProfileOverviewResponse;
    assert.equal(overview.profile.access, "granted_read");
    assert.deepEqual(overview.recentDocuments, []);
    assert.equal(overview.reviewQueue.documentCount, 0);
  });
});
