import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { DemoRegistrationResponse } from "@veylta/contracts";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app.js";
import { createCarePlanService } from "../src/care-plan/care-plan-service.js";
import { registerCarePlanRoutes } from "../src/care-plan/routes.js";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";

const webOrigin = "http://127.0.0.1:4300";

interface Identity {
  body: DemoRegistrationResponse;
  cookie: string;
  userId: string;
}

function cookieFrom(response: LightMyRequestResponse): string {
  const value = response.headers["set-cookie"];
  const header = Array.isArray(value) ? value[0] : value;
  if (typeof header !== "string") throw new Error("Expected session cookie");
  return header.split(";", 1)[0] ?? "";
}

function carePlanPath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}/care-plan`;
}

async function register(app: FastifyInstance, label: string): Promise<Identity> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/demo/registrations",
    headers: { origin: webOrigin },
    payload: {
      displayName: `${label} owner`,
      familyName: `${label} family`,
      profileName: `${label} profile`,
    },
  });
  assert.equal(response.statusCode, 201);
  const cookie = cookieFrom(response);
  const session = await app.inject({ method: "GET", url: "/v1/session", headers: { cookie } });
  assert.equal(session.statusCode, 200);
  return { body: response.json(), cookie, userId: session.json().user.id as string };
}

test("a profile care plan is actionable, replay-safe, and profile-authorized", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-care-plan-"));
  const database = createDatabase(join(root, "test.sqlite"));
  await migrateUp(database);
  const app = buildApp({ readiness: { check: async () => undefined }, logger: false });
  const family = createFamilyService(database, {
    cookieName: "veylta_session",
    secureCookie: false,
    sessionTtlSeconds: 3_600,
  });
  registerFamilyRoutes(app, family, {
    allowedMutationOrigins: [webOrigin],
    demoRegistrationEnabled: true,
  });
  registerCarePlanRoutes(app, family, createCarePlanService(database), {
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
      contractVersion: "home-care-plan/v1",
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
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
});
