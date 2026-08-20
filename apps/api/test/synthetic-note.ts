import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { Database } from "../src/database/pool.js";
import { extractNextDocument, uploadDocument } from "./document-app.js";
import type { Identity } from "./medical-profile-app.js";
import { createSyntheticIntelligence } from "./synthetic-intelligence.js";

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
  const upload = await uploadDocument(
    app,
    identity,
    await readFile(fixtureUrl),
    `upload-${randomUUID()}`,
    { filename: "synthetic-note.pdf" },
  );
  assert.equal(upload.statusCode, 202, upload.body);
  const documentId = upload.json().document.id as string;
  await extractNextDocument(
    { database, storageRoot },
    { intelligence: createSyntheticIntelligence() },
  );
  return { documentId, profilePath };
}
