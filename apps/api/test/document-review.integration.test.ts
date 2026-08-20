import assert from "node:assert/strict";
import test from "node:test";
import { DOCUMENT_CONTRACT_VERSION } from "@veylta/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { Database } from "../src/database/pool.js";
import { uploadAndExtract, withDocumentContext } from "./document-app.js";
import { type Identity, register, webOrigin } from "./family-app.js";

function documentUrl(identity: Identity, documentId: string): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}/documents/${documentId}`;
}

async function registeredReviewer(
  database: Database,
  owner: Identity,
): Promise<{ id: string; displayName: string }> {
  const row = (
    await database.query<{ id: string; display_name: string }>(
      `SELECT u.id, u.display_name
         FROM users u
         JOIN family_memberships membership
           ON membership.user_id = u.id
        WHERE membership.family_id = $1 AND membership.role = 'owner' AND membership.status = 'active'`,
      [owner.body.family.id],
    )
  ).rows[0];
  if (row === undefined) throw new Error("Expected registered family owner");
  return { id: row.id, displayName: row.display_name };
}

async function review(
  app: FastifyInstance,
  owner: Identity,
  documentId: string,
  factId: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
  headers: Record<string, string> = {},
): Promise<LightMyRequestResponse> {
  return await app.inject({
    method: "POST",
    url: `${documentUrl(owner, documentId)}/facts/${factId}/review`,
    headers: {
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": idempotencyKey.padEnd(16, "_"),
      ...headers,
    },
    payload: body,
  });
}

test("a fact confirmation atomically records an immutable decision, observation, range, and audit event", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Confirm");
    const reviewer = await registeredReviewer(context.database, owner);
    const prepared = await uploadAndExtract(context, owner, {
      idempotencyKey: "review-confirm-upload",
    });
    assert.deepEqual(
      prepared.facts.map((item) => item.review),
      [null, null],
    );
    const fact = prepared.facts.find((item) => item.factKey === "synthetic-analyte-a");
    if (fact === undefined) throw new Error("Expected the synthetic ambiguous fact");

    const created = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      { factVersion: 1, decision: "confirm" },
      "review-confirm-create",
    );
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().contractVersion, DOCUMENT_CONTRACT_VERSION);
    assert.deepEqual(
      {
        factId: created.json().review.factId,
        factVersion: created.json().review.factVersion,
        outcome: created.json().review.outcome,
        observationId: created.json().review.observationId,
      },
      {
        factId: fact.id,
        factVersion: 1,
        outcome: "confirmed",
        observationId: created.json().review.observationId,
      },
    );
    assert.match(created.json().review.id, /^[0-9a-f-]{36}$/);
    assert.match(created.json().review.decidedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(created.json().review.observationId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(created.json().review.decidedBy, {
      id: reviewer.id,
      displayName: reviewer.displayName,
    });

    const persisted = await context.database.query<{
      outcome: string;
      corrected_source_name: string | null;
      observation_id: string | null;
      source_name: string;
      source_value: string;
      source_unit: string;
      status: string;
      range_count: number;
    }>(
      `SELECT d.outcome, d.corrected_source_name, d.observation_id,
              o.source_name, o.source_value, o.source_unit, o.status,
              (SELECT count(*) FROM observation_reference_ranges r
                WHERE r.family_id = d.family_id AND r.observation_id = d.observation_id) AS range_count
         FROM review_decisions d
         JOIN observations o ON o.family_id = d.family_id AND o.id = d.observation_id
        WHERE d.family_id = $1 AND d.extracted_fact_id = $2`,
      [owner.body.family.id, fact.id],
    );
    assert.deepEqual(persisted.rows, [
      {
        outcome: "confirm",
        corrected_source_name: null,
        observation_id: created.json().review.observationId,
        source_name: fact.sourceName,
        source_value: fact.sourceValue,
        source_unit: fact.sourceUnit,
        status: "confirmed",
        range_count: 1,
      },
    ]);

    const rawFact = await context.database.query<{
      source_value: string;
      review_status: string;
    }>("SELECT source_value, review_status FROM extracted_facts WHERE id = $1", [fact.id]);
    assert.deepEqual(rawFact.rows, [
      { source_value: fact.sourceValue, review_status: "needs_review" },
    ]);

    const reread = await context.app.inject({
      method: "GET",
      url: `${documentUrl(owner, prepared.documentId)}/facts`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(reread.statusCode, 200);
    const rereadFact = reread.json().items.find((item: { id: string }) => item.id === fact.id);
    assert.equal(rereadFact?.reviewStatus, "confirmed");
    assert.deepEqual(rereadFact?.review, {
      id: created.json().review.id,
      outcome: "confirmed",
      decidedAt: created.json().review.decidedAt,
      observationId: created.json().review.observationId,
      correction: null,
      decidedBy: {
        id: reviewer.id,
        displayName: reviewer.displayName,
      },
    });
    const partialProcessing = await context.app.inject({
      method: "GET",
      url: `${documentUrl(owner, prepared.documentId)}/processing`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(partialProcessing.statusCode, 200);
    assert.equal(partialProcessing.json().processing.state, "awaiting_review");

    const replay = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      { factVersion: 1, decision: "confirm" },
      "review-confirm-create",
    );
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), created.json());

    const replayAudit = await context.database.query<{
      action: string;
      resource_type: string;
      result: string;
      metadata: string;
    }>(
      `SELECT action, resource_type, result, metadata
         FROM audit_events
        WHERE family_id = $1
          AND resource_id = $2
          AND action = 'document.fact.review.replayed'`,
      [owner.body.family.id, fact.id],
    );
    assert.deepEqual(replayAudit.rows, [
      {
        action: "document.fact.review.replayed",
        resource_type: "ExtractedFact",
        result: "success",
        metadata: JSON.stringify({ contractVersion: DOCUMENT_CONTRACT_VERSION }),
      },
    ]);

    const changedReplay = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      { factVersion: 1, decision: "reject" },
      "review-confirm-create",
    );
    assert.equal(changedReplay.statusCode, 409);
    assert.equal(changedReplay.json().error.code, "IDEMPOTENCY_CONFLICT");

    const counts = await context.database.query<{
      decisions: number;
      observations: number;
      requests: number;
    }>(
      `SELECT
         (SELECT count(*) FROM review_decisions WHERE family_id = $1) AS decisions,
         (SELECT count(*) FROM observations WHERE family_id = $1) AS observations,
         (SELECT count(*) FROM review_requests WHERE family_id = $1) AS requests`,
      [owner.body.family.id],
    );
    assert.deepEqual(counts.rows, [{ decisions: 1, observations: 1, requests: 1 }]);
    const audit = await context.database.query<{
      count: number;
      resource_type: string;
      metadata: string;
    }>(
      `SELECT count(*) AS count, resource_type, metadata
         FROM audit_events
        WHERE family_id = $1 AND resource_id = $2 AND action = 'document.fact.reviewed'`,
      [owner.body.family.id, fact.id],
    );
    assert.deepEqual(audit.rows, [
      {
        count: 1,
        resource_type: "ExtractedFact",
        metadata: JSON.stringify({ contractVersion: DOCUMENT_CONTRACT_VERSION }),
      },
    ]);
  });
});

test("a correction creates a confirmed observation without changing raw extraction, while rejection creates no observation", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Correct and reject");
    const reviewer = await registeredReviewer(context.database, owner);
    const prepared = await uploadAndExtract(context, owner, {
      idempotencyKey: "review-correct-upload",
    });
    const correcting = prepared.facts.find((item) => item.factKey === "synthetic-analyte-a");
    const rejecting = prepared.facts.find((item) => item.factKey === "synthetic-analyte-b");
    if (correcting === undefined || rejecting === undefined)
      throw new Error("Expected two extracted facts");

    const corrected = await review(
      context.app,
      owner,
      prepared.documentId,
      correcting.id,
      {
        factVersion: 1,
        decision: "correct",
        correction: {
          sourceName: "Corrected synthetic analyte",
          sourceValue: "8.25",
          sourceUnit: "corrected-unit",
        },
      },
      "review-correct-create",
    );
    assert.equal(corrected.statusCode, 201);
    assert.equal(corrected.json().review.outcome, "corrected");
    assert.match(corrected.json().review.observationId, /^[0-9a-f-]{36}$/);

    const rejected = await review(
      context.app,
      owner,
      prepared.documentId,
      rejecting.id,
      { factVersion: 1, decision: "reject" },
      "review-reject-create",
    );
    assert.equal(rejected.statusCode, 201);
    assert.deepEqual(
      {
        outcome: rejected.json().review.outcome,
        observationId: rejected.json().review.observationId,
      },
      { outcome: "rejected", observationId: null },
    );

    const correctedRows = await context.database.query<{
      source_name: string;
      source_value: string;
      source_unit: string;
      raw_source_value: string;
    }>(
      `SELECT o.source_name, o.source_value, o.source_unit, f.source_value AS raw_source_value
         FROM observations o
         JOIN extracted_facts f ON f.family_id = o.family_id AND f.id = o.source_extracted_fact_id
        WHERE o.family_id = $1 AND o.source_extracted_fact_id = $2`,
      [owner.body.family.id, correcting.id],
    );
    assert.deepEqual(correctedRows.rows, [
      {
        source_name: "Corrected synthetic analyte",
        source_value: "8.25",
        source_unit: "corrected-unit",
        raw_source_value: correcting.sourceValue,
      },
    ]);
    const rejectedObservations = await context.database.query<{ count: number }>(
      "SELECT count(*) AS count FROM observations WHERE family_id = $1 AND source_extracted_fact_id = $2",
      [owner.body.family.id, rejecting.id],
    );
    assert.equal(Number(rejectedObservations.rows[0]?.count), 0);

    const completed = await context.app.inject({
      method: "GET",
      url: `${documentUrl(owner, prepared.documentId)}/processing`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(completed.statusCode, 200);
    assert.deepEqual(
      {
        state: completed.json().processing.state,
        factCount: completed.json().processing.factCount,
      },
      { state: "completed", factCount: 2 },
    );
    const reviewedFacts = await context.app.inject({
      method: "GET",
      url: `${documentUrl(owner, prepared.documentId)}/facts`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(reviewedFacts.statusCode, 200);
    assert.deepEqual(
      reviewedFacts.json().items.map((item: { reviewStatus: string }) => item.reviewStatus),
      ["confirmed", "rejected"],
    );
    const rereadCorrection = reviewedFacts
      .json()
      .items.find((item: { id: string }) => item.id === correcting.id);
    assert.deepEqual(rereadCorrection?.review, {
      id: corrected.json().review.id,
      outcome: "corrected",
      decidedAt: corrected.json().review.decidedAt,
      observationId: corrected.json().review.observationId,
      decidedBy: reviewer,
      correction: {
        sourceName: "Corrected synthetic analyte",
        sourceValue: "8.25",
        sourceUnit: "corrected-unit",
      },
    });
    const rereadRejection = reviewedFacts
      .json()
      .items.find((item: { id: string }) => item.id === rejecting.id);
    assert.deepEqual(rereadRejection?.review, {
      id: rejected.json().review.id,
      outcome: "rejected",
      decidedAt: rejected.json().review.decidedAt,
      observationId: null,
      decidedBy: reviewer,
      correction: null,
    });
  });
});

test("review commands reject stale or conflicting decisions, invalid corrections, missing origin, and cross-family access", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Conflicts owner");
    const outsider = await register(context.app, "Conflicts outsider");
    const prepared = await uploadAndExtract(context, owner, {
      idempotencyKey: "review-conflicts-upload",
    });
    const fact = prepared.facts[0];
    if (fact === undefined) throw new Error("Expected an extracted fact");

    const stale = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      { factVersion: 2, decision: "confirm" },
      "review-stale-version",
    );
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, "CONFLICT");

    const invalidCorrection = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      { factVersion: 1, decision: "correct", correction: { sourceName: "only name" } },
      "review-invalid-correction",
    );
    assert.equal(invalidCorrection.statusCode, 400);

    const forbiddenCorrection = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      {
        factVersion: 1,
        decision: "confirm",
        correction: { sourceName: "wrong", sourceValue: "1", sourceUnit: "u" },
      },
      "review-forbidden-correction",
    );
    assert.equal(forbiddenCorrection.statusCode, 400);

    const overlongCorrection = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      {
        factVersion: 1,
        decision: "correct",
        correction: { sourceName: "name", sourceValue: "v".repeat(101), sourceUnit: "u" },
      },
      "review-overlong-correction",
    );
    assert.equal(overlongCorrection.statusCode, 400);

    const noOrigin = await context.app.inject({
      method: "POST",
      url: `${documentUrl(owner, prepared.documentId)}/facts/${fact.id}/review`,
      headers: { cookie: owner.cookie, "idempotency-key": "review-no-origin".padEnd(16, "_") },
      payload: { factVersion: 1, decision: "confirm" },
    });
    assert.equal(noOrigin.statusCode, 403);

    const noKey = await context.app.inject({
      method: "POST",
      url: `${documentUrl(owner, prepared.documentId)}/facts/${fact.id}/review`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { factVersion: 1, decision: "confirm" },
    });
    assert.equal(noKey.statusCode, 400);
    assert.equal(noKey.json().error.code, "INVALID_IDEMPOTENCY_KEY");

    const crossFamily = await context.app.inject({
      method: "POST",
      url: `${documentUrl(owner, prepared.documentId)}/facts/${fact.id}/review`,
      headers: {
        cookie: outsider.cookie,
        origin: webOrigin,
        "idempotency-key": "review-cross-family".padEnd(16, "_"),
      },
      payload: { factVersion: 1, decision: "confirm" },
    });
    assert.equal(crossFamily.statusCode, 404);
    assert.equal(crossFamily.json().error.code, "RESOURCE_NOT_FOUND");
    assert.equal(crossFamily.rawPayload.includes(fact.id), false);

    const created = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      { factVersion: 1, decision: "confirm" },
      "review-first-decision",
    );
    assert.equal(created.statusCode, 201);
    const reusedKeyWithDifferentCommand = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      { factVersion: 1, decision: "reject" },
      "review-first-decision",
    );
    assert.equal(reusedKeyWithDifferentCommand.statusCode, 409);
    const differentKey = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      { factVersion: 1, decision: "confirm" },
      "review-different-decision",
    );
    assert.equal(differentKey.statusCode, 409);
  });
});

test("an audit failure rolls back review decision, observation, reference range, and idempotency record together", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Atomic rollback");
    const prepared = await uploadAndExtract(context, owner, {
      idempotencyKey: "review-atomic-upload",
    });
    const fact = prepared.facts[0];
    if (fact === undefined) throw new Error("Expected an extracted fact");

    await context.database.exec(`
      CREATE TRIGGER force_review_audit_failure
      BEFORE INSERT ON audit_events
      WHEN NEW.action = 'document.fact.reviewed'
      BEGIN
        SELECT RAISE(ABORT, 'forced review audit failure');
      END;
    `);
    const failed = await review(
      context.app,
      owner,
      prepared.documentId,
      fact.id,
      { factVersion: 1, decision: "confirm" },
      "review-atomic-create",
    );
    assert.equal(failed.statusCode, 500);
    await context.database.exec("DROP TRIGGER force_review_audit_failure");

    const counts = await context.database.query<{
      decisions: number;
      observations: number;
      ranges: number;
      requests: number;
    }>(
      `SELECT
         (SELECT count(*) FROM review_decisions WHERE family_id = $1) AS decisions,
         (SELECT count(*) FROM observations WHERE family_id = $1) AS observations,
         (SELECT count(*) FROM observation_reference_ranges WHERE family_id = $1) AS ranges,
         (SELECT count(*) FROM review_requests WHERE family_id = $1) AS requests`,
      [owner.body.family.id],
    );
    assert.deepEqual(counts.rows, [{ decisions: 0, observations: 0, ranges: 0, requests: 0 }]);
  });
});
