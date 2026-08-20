import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { Database } from "../src/database/pool.js";
import { createDocumentService, type DocumentService } from "../src/documents/document-service.js";
import { registerDocumentRoutes } from "../src/documents/routes.js";
import type { FamilyService } from "../src/family/family-service.js";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import type { ObjectStorage } from "../src/storage/object-storage.js";
import { createFamilyApp, createTempDatabase, type Identity, webOrigin } from "./family-app.js";

export const labReportFixtureUrl = new URL(
  "../../../fixtures/veylta-synthetic-lab-report.pdf",
  import.meta.url,
);

export interface DocumentAppOptions {
  maxDocumentBytes?: number;
  /** Builds the storage from the storage root, so tests can inject a faulty one. */
  storage?: (storageRoot: string) => ObjectStorage;
}

export interface DocumentTestContext {
  app: FastifyInstance;
  database: Database;
  storageRoot: string;
}

/** Family + document routes over the given database and storage root. */
export function createDocumentApp(
  database: Database,
  storageRoot: string,
  options: DocumentAppOptions = {},
): { app: FastifyInstance; familyService: FamilyService; documentService: DocumentService } {
  const maxDocumentBytes = options.maxDocumentBytes ?? MAX_SYNTHETIC_DOCUMENT_BYTES;
  const storage = (options.storage ?? createLocalObjectStorage)(storageRoot);
  const { app, familyService } = createFamilyApp(database);
  const documentService = createDocumentService(database, storage, { maxDocumentBytes });
  registerDocumentRoutes(app, familyService, documentService, {
    allowedMutationOrigins: [webOrigin],
    maxDocumentBytes,
  });
  return { app, familyService, documentService };
}

/** A migrated temp database, storage root, and document app; cleans up around `operation`. */
export async function withDocumentContext(
  operation: (context: DocumentTestContext) => Promise<void>,
  options: DocumentAppOptions = {},
): Promise<void> {
  const temp = await createTempDatabase();
  const storageRoot = join(temp.root, "storage");
  const { app } = createDocumentApp(temp.database, storageRoot, options);
  try {
    await operation({ app, database: temp.database, storageRoot });
  } finally {
    await app.close();
    await temp.close();
  }
}

export interface MultipartFileOptions {
  contentType?: string;
  filename?: string;
}

/** One synthetic file as a multipart/form-data body. */
export function multipartFile(
  bytes: Buffer,
  {
    contentType = "application/pdf",
    filename = "synthetic-lab-report.pdf",
  }: MultipartFileOptions = {},
): { body: Buffer; contentType: string } {
  const boundary = `veylta-${randomUUID()}`;
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

/** POST one synthetic document; the caller asserts the response it expects. */
export async function uploadDocument(
  app: FastifyInstance,
  identity: Identity,
  bytes: Buffer,
  idempotencyKey: string,
  options: MultipartFileOptions & { profileId?: string } = {},
): Promise<LightMyRequestResponse> {
  const multipart = multipartFile(bytes, options);
  const profileId = options.profileId ?? identity.body.profile.id;
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

/** Runs the extraction worker once over the context's database and storage; must complete. */
export async function extractNextDocument(
  context: Pick<DocumentTestContext, "database" | "storageRoot">,
  options: {
    intelligence?: Parameters<typeof createDocumentExtractionProcessor>[0]["intelligence"];
  } = {},
): Promise<void> {
  const processed = await createDocumentExtractionProcessor({
    database: context.database,
    storage: createLocalObjectStorage(context.storageRoot),
    ...(options.intelligence === undefined ? {} : { intelligence: options.intelligence }),
  }).processNext({ workerId: `worker-${randomUUID()}`, leaseDurationMs: 60_000, retryDelayMs: 1 });
  assert.equal(processed.status, "completed");
}

export interface PreparedDocument {
  documentId: string;
  facts: Array<{
    id: string;
    factKey: string;
    factVersion: number;
    sourceName: string;
    sourceValue: string;
    sourceUnit: string;
    reviewStatus: string;
    review: unknown;
  }>;
}

/** Uploads the laboratory fixture (with `marker` appended for distinct bytes), extracts, lists facts. */
export async function uploadAndExtract(
  context: DocumentTestContext,
  owner: Identity,
  options: {
    idempotencyKey?: string;
    filename?: string;
    marker?: string;
    /** Reads the source in place of the deterministic parser — to vary the shape a run produces. */
    intelligence?: Parameters<typeof createDocumentExtractionProcessor>[0]["intelligence"];
  } = {},
): Promise<PreparedDocument> {
  const fixture = await readFile(labReportFixtureUrl);
  const bytes =
    options.marker === undefined
      ? fixture
      : Buffer.concat([fixture, Buffer.from(`\n% ${options.marker}\n`)]);
  const uploaded = await uploadDocument(
    context.app,
    owner,
    bytes,
    options.idempotencyKey ?? `document-${randomUUID()}`,
    options.filename === undefined ? {} : { filename: options.filename },
  );
  assert.equal(uploaded.statusCode, 202, uploaded.rawPayload.toString());
  const documentId = uploaded.json().document.id as string;
  await extractNextDocument(
    context,
    options.intelligence === undefined ? {} : { intelligence: options.intelligence },
  );
  const facts = await context.app.inject({
    method: "GET",
    url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}/facts`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(facts.statusCode, 200);
  return { documentId, facts: facts.json().items };
}
