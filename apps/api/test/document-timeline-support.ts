import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "../src/database/pool.js";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { createObjectStorageKey } from "../src/storage/object-storage.js";
import { multipartFile, type SyntheticFact, syntheticFacts } from "./confirmed-observations.js";
import type { Identity } from "./medical-profile-app.js";
import { webOrigin } from "./medical-profile-app.js";
import { createSyntheticImageOnlyPdf } from "./synthetic-image-only-pdf.js";
import { createSyntheticIntelligence } from "./synthetic-intelligence.js";

// The two documents the timeline test needs beside the shared fixtures: one that stays in the
// queue, and a way to fail a reviewed one terminally.

function profilePath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
}

/**
 * A scanned report analysed today and left undecided — the queue's own document. Its bytes differ
 * from the text-layer fixture, so the upload is a document of its own rather than a reuse.
 */
export async function queuedReport(
  app: FastifyInstance,
  database: Database,
  storageRoot: string,
  identity: Identity,
): Promise<{ documentId: string; facts: SyntheticFact[] }> {
  const scan = createSyntheticImageOnlyPdf([
    "VEYLTA SYNTHETIC LAB REPORT v1",
    "SCANNED COPY - SYNTHETIC TEST DATA",
  ]);
  const multipart = multipartFile(scan, "queued-scan.pdf");
  const upload = await app.inject({
    method: "POST",
    url: `${profilePath(identity)}/documents`,
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
  return { documentId, facts: await syntheticFacts(app, identity, documentId) };
}

/**
 * Restarts a document's analysis through the public route and lets the new job fail terminally:
 * one attempt allowed, and the source object removed underneath it, exactly as
 * `document-processing.integration.test.ts` produces `DOCUMENT_UNAVAILABLE`.
 */
export async function deadLetterLatestJob(
  app: FastifyInstance,
  database: Database,
  storageRoot: string,
  identity: Identity,
  documentId: string,
): Promise<void> {
  const restarted = await app.inject({
    method: "POST",
    url: `${profilePath(identity)}/documents/${documentId}/processing/restart`,
    headers: {
      cookie: identity.cookie,
      origin: webOrigin,
      "idempotency-key": `restart-${randomUUID()}`,
    },
  });
  assert.equal(restarted.statusCode, 202, restarted.body);
  const job = await database.query<{ storage_key: string }>(
    `UPDATE processing_jobs SET max_attempts = 1
      WHERE family_id = $1
        AND document_version_id = (SELECT id FROM document_versions WHERE document_id = $2)
        AND state = 'pending'
     RETURNING (SELECT b.storage_key
                  FROM document_versions v
                  JOIN document_blobs b ON b.family_id = v.family_id AND b.id = v.blob_id
                 WHERE v.id = processing_jobs.document_version_id) AS storage_key`,
    [identity.body.family.id, documentId],
  );
  const storageKey = job.rows[0]?.storage_key;
  assert.ok(storageKey !== undefined, "the restarted job must name the object it would read");
  const storage = createLocalObjectStorage(storageRoot);
  await storage.deleteForRecovery(createObjectStorageKey(storageKey), {
    intent: "repair_or_recovery",
    reason: "Synthetic timeline dead-letter pin",
  });
  const failed = await createDocumentExtractionProcessor({ database, storage }).processNext({
    workerId: `worker-${randomUUID()}`,
    leaseDurationMs: 60_000,
    retryDelayMs: 1,
  });
  assert.equal(failed.status, "dead_letter");
}
