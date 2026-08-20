import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Database } from "../src/database/pool.js";
import { uploadAndExtract } from "./document-app.js";
import { type Identity, webOrigin } from "./medical-profile-app.js";

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
 * the way the caller decides — the only path that yields real confirmed observations. A profile's
 * second report needs a `marker`: uploads are addressed by checksum, so the same bytes come back
 * as the first document instead of a new one.
 */
export async function confirmSyntheticReport(
  app: FastifyInstance,
  database: Database,
  storageRoot: string,
  identity: Identity,
  decide: (factKey: string) => SyntheticReviewDecision = () => "confirm",
  marker?: string,
): Promise<{ documentId: string; observationIds: string[] }> {
  const prepared = await uploadAndExtract({ app, database, storageRoot }, identity, {
    filename: "synthetic-report.pdf",
    ...(marker === undefined ? {} : { marker }),
  });
  const documentId = prepared.documentId;
  await reviewSyntheticFacts(app, identity, documentId, prepared.facts, decide);
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
