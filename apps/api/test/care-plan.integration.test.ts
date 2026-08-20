import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createCarePlanService } from "../src/care-plan/care-plan-service.js";
import { registerCarePlanRoutes } from "../src/care-plan/routes.js";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { syntheticPreference } from "./codex-preference.js";
import { createDocumentApp } from "./document-app.js";
import {
  createFamilyApp,
  createTempDatabase,
  type Identity,
  register,
  webOrigin,
} from "./family-app.js";

const fixtureUrl = new URL("../../../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);

function carePlanPath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}/care-plan`;
}

function multipartFile(bytes: Buffer) {
  const boundary = `veylta-care-${randomUUID()}`;
  return {
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="care-plan.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

test("a profile care plan is actionable, replay-safe, and profile-authorized", async () => {
  const temp = await createTempDatabase();
  const database = temp.database;
  const { app, familyService } = createFamilyApp(database);
  registerCarePlanRoutes(app, familyService, createCarePlanService(database), {
    allowedMutationOrigins: [webOrigin],
  });

  try {
    const owner = await register(app, "Care owner");
    const reader = await register(app, "Care reader");
    const outsider = await register(app, "Care outsider");
    const path = carePlanPath(owner);

    const initial = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie: owner.cookie },
    });
    assert.equal(initial.statusCode, 200, initial.body);
    assert.equal(initial.headers["cache-control"], "no-store");
    assert.deepEqual(initial.json(), {
      contractVersion: "home-care-plan/v2",
      profileId: owner.body.profile.id,
      canWrite: true,
      evidence: {
        sourceCount: 0,
        pendingReviewCount: 0,
        confirmedObservationCount: 0,
        latestSummary: null,
      },
      items: [],
    });

    const itemId = randomUUID();
    const created = await app.inject({
      method: "PUT",
      url: `${path}/items/${itemId}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: {
        category: "laboratory",
        title: "Обсудить повторный анализ",
        note: "Сверить с подтверждённым источником перед записью.",
        scheduledFor: "2026-09-15",
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const createdItem = created.json().item as Record<string, unknown>;
    assert.deepEqual(
      {
        id: createdItem.id,
        category: createdItem.category,
        title: createdItem.title,
        note: createdItem.note,
        scheduledFor: createdItem.scheduledFor,
        state: createdItem.state,
        origin: createdItem.origin,
        revision: createdItem.revision,
        provenance: createdItem.provenance,
      },
      {
        id: itemId,
        category: "laboratory",
        title: "Обсудить повторный анализ",
        note: "Сверить с подтверждённым источником перед записью.",
        scheduledFor: "2026-09-15",
        state: "accepted",
        origin: "user",
        revision: 1,
        provenance: null,
      },
    );

    const replay = await app.inject({
      method: "PUT",
      url: `${path}/items/${itemId}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: {
        category: "laboratory",
        title: "Обсудить повторный анализ",
        note: "Сверить с подтверждённым источником перед записью.",
        scheduledFor: "2026-09-15",
      },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().item.id, itemId);

    const conflictingReplay = await app.inject({
      method: "PUT",
      url: `${path}/items/${itemId}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: {
        category: "clinician",
        title: "Подменённое действие",
        note: null,
        scheduledFor: null,
      },
    });
    assert.equal(conflictingReplay.statusCode, 409);

    const completed = await app.inject({
      method: "PUT",
      url: `${path}/items/${itemId}/state`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { revision: 1, state: "completed", scheduledFor: "2026-09-15" },
    });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.equal(completed.json().item.state, "completed");
    assert.equal(completed.json().item.revision, 2);

    const completedReplay = await app.inject({
      method: "PUT",
      url: `${path}/items/${itemId}/state`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { revision: 1, state: "completed", scheduledFor: "2026-09-15" },
    });
    assert.equal(completedReplay.statusCode, 200, completedReplay.body);
    assert.equal(completedReplay.json().item.revision, 2);

    const impossibleTransition = await app.inject({
      method: "PUT",
      url: `${path}/items/${itemId}/state`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { revision: 2, state: "accepted", scheduledFor: "2026-09-15" },
    });
    assert.equal(impossibleTransition.statusCode, 409);

    await database.transaction(async (client) => {
      await client.query(
        `INSERT INTO family_memberships
           (family_id, user_id, role, status, created_at)
         VALUES ($1, $2, 'caregiver', 'active', $3)`,
        [owner.body.family.id, reader.userId, new Date()],
      );
      await client.query(
        `INSERT INTO profile_consent_grants
           (id, family_id, patient_profile_id, grantee_user_id, capability,
            granted_by_user_id, created_at)
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

    const grantedRead = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie: reader.cookie },
    });
    assert.equal(grantedRead.statusCode, 200, grantedRead.body);
    assert.equal(grantedRead.json().canWrite, false);
    assert.equal(grantedRead.json().items[0]?.title, "Обсудить повторный анализ");

    const grantedWrite = await app.inject({
      method: "PUT",
      url: `${path}/items/${randomUUID()}`,
      headers: { cookie: reader.cookie, origin: webOrigin },
      payload: {
        category: "reminder",
        title: "Недоступное изменение",
        note: null,
        scheduledFor: null,
      },
    });
    assert.equal(grantedWrite.statusCode, 404);
    assert.doesNotMatch(grantedWrite.body, /Обсудить повторный анализ/);

    const foreign = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie: outsider.cookie },
    });
    assert.equal(foreign.statusCode, 404);
    assert.doesNotMatch(foreign.body, /Обсудить повторный анализ|Care owner/);

    const audit = await database.query<{
      action: string;
      metadata: string;
      resource_type: string;
    }>(
      `SELECT action, metadata, resource_type
         FROM audit_events
        WHERE family_id = $1
          AND action LIKE 'profile.care_plan.%'
        ORDER BY created_at, id`,
      [owner.body.family.id],
    );
    assert.deepEqual(
      audit.rows.map((row) => row.action).sort(),
      [
        "profile.care_plan.item_created",
        "profile.care_plan.item_completed",
        "profile.care_plan.item_replayed",
        "profile.care_plan.opened",
        "profile.care_plan.opened",
        "profile.care_plan.state_replayed",
      ].sort(),
    );
    assert.doesNotMatch(JSON.stringify(audit.rows), /повторный анализ|подтверждённым источником/i);
    assert.equal(
      audit.rows.find((row) => row.action === "profile.care_plan.opened")?.resource_type,
      "PatientProfile",
    );
    assert.ok(
      audit.rows
        .filter((row) => row.action !== "profile.care_plan.opened")
        .every((row) => row.resource_type === "CarePlanItem"),
    );
  } finally {
    await app.close();
    await temp.close();
  }
});

test("an explicit Codex run stores bounded drafts once and never exposes source values in audit", async () => {
  const temp = await createTempDatabase();
  const database = temp.database;
  const storageRoot = join(temp.root, "storage");
  const { app, familyService } = createDocumentApp(database, storageRoot);
  let generated = 0;
  registerCarePlanRoutes(
    app,
    familyService,
    createCarePlanService(database, {
      generator: {
        async executionProfile() {
          return syntheticPreference({ modelId: "gpt-5.4-mini" });
        },
        async generate(input) {
          generated += 1;
          assert.equal(input.evidence.length, 1);
          assert.equal(input.evidence[0]?.sourceValue, "7.0");
          if (generated === 1) {
            const current = (
              await database.query<{
                available_confirmed_observation_count: number;
                family_id: string;
                id: string;
                missing_data: string;
                observation_id: string;
                patient_profile_id: string;
                recommendation_codes: string;
                version: number;
              }>(
                `SELECT summary.id, summary.family_id, summary.patient_profile_id,
                        summary.version, summary.available_confirmed_observation_count,
                        summary.missing_data, summary.recommendation_codes,
                        evidence.observation_id
                   FROM health_summaries summary
                   JOIN health_summary_evidence evidence
                     ON evidence.family_id = summary.family_id
                    AND evidence.health_summary_id = summary.id
                  WHERE summary.id = $1 AND evidence.position = 1`,
                [input.healthSummary.id],
              )
            ).rows[0];
            assert.ok(current);
            const nextSummaryId = randomUUID();
            const now = new Date();
            await database.transaction(async (client) => {
              await client.query(
                `INSERT INTO health_summaries
                   (id, family_id, patient_profile_id, version, previous_summary_id,
                    summary_contract_version, included_evidence_count,
                    available_confirmed_observation_count, missing_data,
                    recommendation_codes, created_at)
                 VALUES ($1, $2, $3, $4, $5, 'health-summary/v1', 1, $6, $7, $8, $9)`,
                [
                  nextSummaryId,
                  current.family_id,
                  current.patient_profile_id,
                  current.version + 1,
                  current.id,
                  current.available_confirmed_observation_count,
                  current.missing_data,
                  current.recommendation_codes,
                  now,
                ],
              );
              await client.query(
                `INSERT INTO health_summary_evidence
                   (health_summary_id, family_id, observation_id, position,
                    is_new_since_previous_summary, created_at)
                 VALUES ($1, $2, $3, 1, 0, $4)`,
                [nextSummaryId, current.family_id, current.observation_id, now],
              );
            });
          }
          return {
            modelId: "gpt-5.4-mini",
            runtimeVersion: "codex-cli 0.147.0",
            items: [
              {
                category: "laboratory",
                sourceObservationIndex: 0,
                missingContext: ["sample_date"],
              },
              {
                category: "nutrition",
                sourceObservationIndex: null,
                missingContext: ["dietary_restrictions"],
              },
            ],
          };
        },
      },
    }),
    { allowedMutationOrigins: [webOrigin] },
  );

  try {
    const owner = await register(app, "Codex care owner");
    const outsider = await register(app, "Codex care outsider");
    const profilePath = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}`;
    const multipart = multipartFile(await readFile(fixtureUrl));
    const upload = await app.inject({
      method: "POST",
      url: `${profilePath}/documents`,
      headers: {
        cookie: owner.cookie,
        origin: webOrigin,
        "content-type": multipart.contentType,
        "idempotency-key": `care-upload-${randomUUID()}`,
      },
      payload: multipart.body,
    });
    assert.equal(upload.statusCode, 202, upload.body);
    const documentId = upload.json().document.id as string;
    assert.equal(
      (
        await createDocumentExtractionProcessor({
          database,
          storage: createLocalObjectStorage(storageRoot),
        }).processNext({
          workerId: `care-worker-${randomUUID()}`,
          leaseDurationMs: 60_000,
          retryDelayMs: 1,
        })
      ).status,
      "completed",
    );
    const facts = await app.inject({
      method: "GET",
      url: `${profilePath}/documents/${documentId}/facts`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(facts.statusCode, 200, facts.body);
    const items = facts.json().items as Array<{ id: string; factKey: string; factVersion: number }>;
    for (const fact of items) {
      const decision = fact.factKey === "synthetic-analyte-a" ? "confirm" : "reject";
      const review = await app.inject({
        method: "POST",
        url: `${profilePath}/documents/${documentId}/facts/${fact.id}/review`,
        headers: {
          cookie: owner.cookie,
          origin: webOrigin,
          "idempotency-key": `care-review-${randomUUID()}`,
        },
        payload: { factVersion: fact.factVersion, decision },
      });
      assert.equal(review.statusCode, 201, review.body);
    }

    const endpoint = `${profilePath}/care-plan/proposals`;
    const missingOrigin = await app.inject({
      method: "POST",
      url: endpoint,
      headers: { cookie: owner.cookie },
      payload: { acknowledgement: "send_confirmed_summary_to_codex" },
    });
    assert.equal(missingOrigin.statusCode, 403);
    assert.equal(generated, 0);

    const missingAcknowledgement = await app.inject({
      method: "POST",
      url: endpoint,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: {},
    });
    assert.equal(missingAcknowledgement.statusCode, 400);
    assert.equal(generated, 0);

    const denied = await app.inject({
      method: "POST",
      url: endpoint,
      headers: { cookie: outsider.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_summary_to_codex" },
    });
    assert.equal(denied.statusCode, 404);
    assert.equal(generated, 0);

    const stale = await app.inject({
      method: "POST",
      url: endpoint,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_summary_to_codex" },
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(generated, 1);
    const staleState = await database.query<{ failure_code: string; state: string }>(
      `SELECT state, failure_code
         FROM care_plan_proposal_runs
        WHERE health_summary_id = (
          SELECT id FROM health_summaries
           WHERE family_id = $1 AND patient_profile_id = $2 AND version = 1
        )`,
      [owner.body.family.id, owner.body.profile.id],
    );
    assert.deepEqual(staleState.rows, [{ state: "failed", failure_code: "SUMMARY_CHANGED" }]);
    assert.equal(
      (
        await database.query<{ count: number }>(
          "SELECT count(*) AS count FROM care_plan_items WHERE family_id = $1 AND origin = 'codex'",
          [owner.body.family.id],
        )
      ).rows[0]?.count,
      0,
    );

    const created = await app.inject({
      method: "POST",
      url: endpoint,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_summary_to_codex" },
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.headers["cache-control"], "no-store");
    assert.equal(generated, 2);
    const createdBody = created.json();
    assert.equal(createdBody.replayed, false);
    assert.equal(createdBody.run.proposalCount, 2);
    assert.equal(createdBody.run.modelId, "gpt-5.4-mini");
    assert.deepEqual(
      createdBody.items.map((item: { category: string; state: string; origin: string }) => ({
        category: item.category,
        state: item.state,
        origin: item.origin,
      })),
      [
        { category: "laboratory", state: "proposed", origin: "codex" },
        { category: "nutrition", state: "proposed", origin: "codex" },
      ],
    );
    assert.ok(
      createdBody.items.every(
        (item: { provenance: { proposalRunId: string; modelId: string } }) =>
          item.provenance.proposalRunId === createdBody.run.id &&
          item.provenance.modelId === "gpt-5.4-mini",
      ),
    );

    const replay = await app.inject({
      method: "POST",
      url: endpoint,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_summary_to_codex" },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().replayed, true);
    assert.equal(replay.json().run.id, createdBody.run.id);
    assert.equal(generated, 2);

    const audits = await database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata FROM audit_events
        WHERE family_id = $1 AND action LIKE 'profile.care_plan.proposals_%'
        ORDER BY created_at, id`,
      [owner.body.family.id],
    );
    assert.deepEqual(
      audits.rows.map((row) => row.action).sort(),
      [
        "profile.care_plan.proposals_completed",
        "profile.care_plan.proposals_failed",
        "profile.care_plan.proposals_replayed",
      ].sort(),
    );
    assert.doesNotMatch(JSON.stringify(audits.rows), /7\.0|sample_date|dietary|gpt-5/i);
  } finally {
    await app.close();
    await temp.close();
  }
});
