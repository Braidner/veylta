import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  type DemoRegistrationResponse,
  MAX_SYNTHETIC_PDF_BYTES,
  OBSERVATION_HISTORY_CONTRACT_VERSION,
  type ObservationHistoryResponse,
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
}

interface PreparedFact {
  documentId: string;
  facts: Array<{
    id: string;
    factKey: string;
    factVersion: number;
    sourceValue: string;
  }>;
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

function multipartFile(bytes: Buffer) {
  const boundary = `veylta-history-${randomUUID()}`;
  return {
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-lab-report.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function profilePath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
}

function documentPath(identity: Identity, documentId: string): string {
  return `${profilePath(identity)}/documents/${documentId}`;
}

function historyPath(identity: Identity): string {
  return `${profilePath(identity)}/observations`;
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
  const testRoot = await mkdtemp(join(tmpdir(), "veylta-observation-history-"));
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
      displayName: `Synthetic Historian ${suffix}`,
      familyName: `Synthetic History Family ${suffix}`,
      profileName: `Synthetic History Profile ${suffix}`,
    },
  });
  assert.equal(response.statusCode, 201);
  return { body: response.json(), cookie: cookieFrom(response) };
}

async function uploadAndExtract(
  context: TestContext,
  owner: Identity,
  idempotencyKey: string,
): Promise<PreparedFact> {
  const fixture = await readFile(fixtureUrl);
  const multipart = multipartFile(fixture);
  const uploaded = await context.app.inject({
    method: "POST",
    url: `${profilePath(owner)}/documents`,
    headers: {
      "content-type": multipart.contentType,
      "idempotency-key": idempotencyKey.padEnd(16, "_"),
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
    workerId: `history-test-worker-${randomUUID()}`,
    leaseDurationMs: 60_000,
    retryDelayMs: 1,
  });
  assert.equal(processed.status, "completed");

  const facts = await context.app.inject({
    method: "GET",
    url: `${documentPath(owner, documentId)}/facts`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(facts.statusCode, 200);
  return { documentId, facts: facts.json().items };
}

async function review(
  app: FastifyInstance,
  owner: Identity,
  documentId: string,
  factId: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<LightMyRequestResponse> {
  return await app.inject({
    method: "POST",
    url: `${documentPath(owner, documentId)}/facts/${factId}/review`,
    headers: {
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": idempotencyKey.padEnd(16, "_"),
    },
    payload: body,
  });
}

test("observation history is source-first, paginated, re-authorized, and audited without payloads", async () => {
  await withTestContext(async (context) => {
    const owner = await registerOwner(context.app, "Owner");
    const outsider = await registerOwner(context.app, "Outsider");
    const prepared = await uploadAndExtract(context, owner, "history-upload");
    const correcting = prepared.facts.find((fact) => fact.factKey === "synthetic-analyte-a");
    const confirming = prepared.facts.find((fact) => fact.factKey === "synthetic-analyte-b");
    if (correcting === undefined || confirming === undefined) {
      throw new Error("Expected two synthetic facts");
    }

    const corrected = await review(
      context.app,
      owner,
      prepared.documentId,
      correcting.id,
      {
        factVersion: correcting.factVersion,
        decision: "correct",
        correction: {
          sourceName: "Corrected synthetic analyte",
          sourceValue: "8.25",
          sourceUnit: "corrected-unit",
        },
      },
      "history-correct",
    );
    assert.equal(corrected.statusCode, 201);
    const confirmed = await review(
      context.app,
      owner,
      prepared.documentId,
      confirming.id,
      { factVersion: confirming.factVersion, decision: "confirm" },
      "history-confirm",
    );
    assert.equal(confirmed.statusCode, 201);

    const first = await context.app.inject({
      method: "GET",
      url: `${historyPath(owner)}?limit=1`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(first.statusCode, 200);
    const firstPage = first.json() as ObservationHistoryResponse;
    assert.equal(firstPage.contractVersion, OBSERVATION_HISTORY_CONTRACT_VERSION);
    assert.equal(firstPage.items.length, 1);
    assert.equal(typeof firstPage.nextCursor, "string");

    const second = await context.app.inject({
      method: "GET",
      url: `${historyPath(owner)}?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(second.statusCode, 200);
    const secondPage = second.json() as ObservationHistoryResponse;
    assert.equal(secondPage.items.length, 1);
    assert.equal(secondPage.nextCursor, null);

    const history = [...firstPage.items, ...secondPage.items];
    assert.equal(new Set(history.map((item) => item.id)).size, 2);
    const correctedItem = history.find((item) => item.source.value === "8.25");
    if (correctedItem === undefined) throw new Error("Expected corrected observation history item");
    assert.deepEqual(correctedItem.source, {
      name: "Corrected synthetic analyte",
      value: "8.25",
      unit: "corrected-unit",
    });
    assert.deepEqual(correctedItem.normalized, {
      value: null,
      unit: null,
      conversionVersion: null,
    });
    assert.deepEqual(correctedItem.referenceRange, {
      sourceText: "5.0–8.0 synthetic-unit",
      sourceLow: null,
      sourceHigh: null,
      sourceUnit: "synthetic-unit",
      laboratoryOutOfRange: null,
      normalizedLow: null,
      normalizedHigh: null,
      normalizedUnit: null,
      conversionVersion: null,
    });
    assert.equal(correctedItem.dates.sampledAt, null);
    assert.equal(correctedItem.dates.resultedAt, null);
    assert.equal(correctedItem.timelineAt, correctedItem.dates.uploadedAt);
    assert.equal(correctedItem.sourceDocument.pageNumber, 1);
    assert.match(correctedItem.sourceDocument.fragment, /FACT\|synthetic-analyte-a/);
    assert.equal(
      correctedItem.sourceDocument.contentPath,
      `${documentPath(owner, prepared.documentId)}/content`,
    );
    assert.equal(correctedItem.confirmed.by.displayName, "Synthetic Historian Owner");

    const raw = await context.database.query<{ source_value: string }>(
      "SELECT source_value FROM extracted_facts WHERE family_id = $1 AND id = $2",
      [owner.body.family.id, correcting.id],
    );
    assert.deepEqual(raw.rows, [{ source_value: correcting.sourceValue }]);

    const source = await context.app.inject({
      method: "GET",
      url: correctedItem.sourceDocument.contentPath,
      headers: { cookie: owner.cookie },
    });
    assert.equal(source.statusCode, 200);
    assert.match(String(source.headers["content-type"]), /^application\/pdf/);

    const filtered = await context.app.inject({
      method: "GET",
      url: `${historyPath(owner)}?canonicalCode=synthetic-analyte-a`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(filtered.statusCode, 200);
    assert.deepEqual(filtered.json().items, []);
    assert.equal(filtered.json().nextCursor, null);

    const unknownQuery = await context.app.inject({
      method: "GET",
      url: `${historyPath(owner)}?unexpected=1`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(unknownQuery.statusCode, 400);
    assert.equal(unknownQuery.json().error.code, "VALIDATION_ERROR");
    const invalidCanonicalCode = await context.app.inject({
      method: "GET",
      url: `${historyPath(owner)}?canonicalCode=UPPERCASE`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(invalidCanonicalCode.statusCode, 400);

    const crossFamily = await context.app.inject({
      method: "GET",
      url: historyPath(owner),
      headers: { cookie: outsider.cookie },
    });
    assert.equal(crossFamily.statusCode, 404);
    assert.equal(crossFamily.rawPayload.includes("Corrected synthetic analyte"), false);
    const crossFamilySource = await context.app.inject({
      method: "GET",
      url: correctedItem.sourceDocument.contentPath,
      headers: { cookie: outsider.cookie },
    });
    assert.equal(crossFamilySource.statusCode, 404);

    const audits = await context.database.query<{
      resource_type: string;
      metadata: string;
    }>(
      `SELECT resource_type, metadata
         FROM audit_events
        WHERE family_id = $1 AND action = 'observation.history.opened'
        ORDER BY created_at, id`,
      [owner.body.family.id],
    );
    assert.deepEqual(audits.rows, [
      {
        resource_type: "PatientProfile",
        metadata: JSON.stringify({ contractVersion: OBSERVATION_HISTORY_CONTRACT_VERSION }),
      },
      {
        resource_type: "PatientProfile",
        metadata: JSON.stringify({ contractVersion: OBSERVATION_HISTORY_CONTRACT_VERSION }),
      },
      {
        resource_type: "PatientProfile",
        metadata: JSON.stringify({ contractVersion: OBSERVATION_HISTORY_CONTRACT_VERSION }),
      },
    ]);
  });
});
