import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { Database } from "../src/database/pool.js";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import type { Identity } from "./medical-profile-app.js";

const webOrigin = "http://127.0.0.1:4300";
const fixtureUrl = new URL("../../../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);

export function multipartFile(bytes: Buffer, filename = "synthetic-report.pdf") {
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

export type SyntheticReviewDecision =
  | "confirm"
  | "reject"
  | {
      readonly decision: "correct";
      readonly correction: {
        readonly sourceName: string;
        readonly sourceValue: string;
        readonly sourceUnit: string;
      };
    };

export interface SyntheticFact {
  readonly id: string;
  readonly factKey: string;
  readonly factVersion: number;
}

/** Lists the facts of a document's latest analysis — the shape the review loop below needs. */
export async function syntheticFacts(
  app: FastifyInstance,
  identity: Identity,
  documentId: string,
): Promise<SyntheticFact[]> {
  const profilePath = `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
  const facts = await app.inject({
    method: "GET",
    url: `${profilePath}/documents/${documentId}/facts`,
    headers: { cookie: identity.cookie },
  });
  assert.equal(facts.statusCode, 200, facts.body);
  return facts.json().items as SyntheticFact[];
}

/** Decides every given fact the way the caller says — the one review loop the helpers share. */
export async function reviewSyntheticFacts(
  app: FastifyInstance,
  identity: Identity,
  documentId: string,
  facts: readonly SyntheticFact[],
  decide: (factKey: string) => SyntheticReviewDecision = () => "confirm",
): Promise<void> {
  const profilePath = `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
  for (const fact of facts) {
    const decision = decide(fact.factKey);
    const review = await app.inject({
      method: "POST",
      url: `${profilePath}/documents/${documentId}/facts/${fact.id}/review`,
      headers: {
        cookie: identity.cookie,
        origin: webOrigin,
        "idempotency-key": `review-${randomUUID()}`,
      },
      payload:
        typeof decision === "string"
          ? { factVersion: fact.factVersion, decision }
          : { factVersion: fact.factVersion, ...decision },
    });
    assert.equal(review.statusCode, 201, review.body);
  }
}

/**
 * Uploads the synthetic laboratory fixture, runs the worker over it and reviews every fact
 * the way the caller decides — the only path that yields real confirmed observations.
 */
export async function confirmSyntheticReport(
  app: FastifyInstance,
  database: Database,
  storageRoot: string,
  identity: Identity,
  decide: (factKey: string) => SyntheticReviewDecision = () => "confirm",
): Promise<{ documentId: string; observationIds: string[] }> {
  const profilePath = `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
  const multipart = multipartFile(await readFile(fixtureUrl));
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
  }).processNext({ workerId: `worker-${randomUUID()}`, leaseDurationMs: 60_000, retryDelayMs: 1 });
  assert.equal(processed.status, "completed");
  await reviewSyntheticFacts(
    app,
    identity,
    documentId,
    await syntheticFacts(app, identity, documentId),
    decide,
  );
  const observations = await database.transaction((client) =>
    client.query<{ id: string }>(
      `SELECT id FROM observations
        WHERE family_id = $1 AND patient_profile_id = $2 AND status = 'confirmed'
        ORDER BY created_at, rowid`,
      [identity.body.family.id, identity.body.profile.id],
    ),
  );
  return { documentId, observationIds: observations.rows.map((row) => row.id) };
}
