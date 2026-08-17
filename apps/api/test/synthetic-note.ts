import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { Database } from "../src/database/pool.js";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { multipartFile } from "./confirmed-observations.js";
import type { Identity } from "./medical-profile-app.js";
import { createSyntheticIntelligence } from "./synthetic-intelligence.js";

const webOrigin = "http://127.0.0.1:4300";
const fixtureUrl = new URL(
  "../../../fixtures/veylta-synthetic-discharge-note.pdf",
  import.meta.url,
);

/**
 * Uploads the synthetic discharge note and runs the worker over it with the test double, so the
 * document carries the clinician's statements as structured results the person can decide on.
 */
export async function analyseSyntheticNote(
  app: FastifyInstance,
  database: Database,
  storageRoot: string,
  identity: Identity,
): Promise<{ documentId: string; profilePath: string }> {
  const profilePath = `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
  const multipart = multipartFile(await readFile(fixtureUrl), "synthetic-note.pdf");
  const upload = await app.inject({
    method: "POST",
    url: `${profilePath}/documents`,
    headers: {
      cookie: identity.cookie,
      origin: webOrigin,
      "content-type": multipart.contentType,
      "idempotency-key": `upload-${randomUUID()}`,
    },
    payload: multipart.body,
  });
  assert.equal(upload.statusCode, 202, upload.body);
  const documentId = upload.json().document.id as string;
  const processed = await createDocumentExtractionProcessor({
    database,
    storage: createLocalObjectStorage(storageRoot),
    intelligence: createSyntheticIntelligence(),
  }).processNext({ workerId: `worker-${randomUUID()}`, leaseDurationMs: 60_000, retryDelayMs: 1 });
  assert.equal(processed.status, "completed");
  return { documentId, profilePath };
}
