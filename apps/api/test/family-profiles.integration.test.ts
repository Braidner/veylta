import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { migrateUp } from "../src/database/migrations.js";
import { createPool } from "../src/database/pool.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";

const webOrigin = "http://127.0.0.1:4300";

function cookieFrom(response: {
  headers: Record<string, number | string | string[] | undefined>;
}): { header: string; pair: string } {
  const headerValue = response.headers["set-cookie"];
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (typeof header !== "string") throw new Error("Expected a Set-Cookie header");
  const pair = header.split(";", 1)[0];
  assert.ok(pair);
  return { header, pair };
}

function errorShape(response: { json(): unknown; statusCode: number }): unknown {
  const body = response.json() as {
    error: { code: string; details: unknown[]; message: string; requestId: string };
  };
  return {
    statusCode: response.statusCode,
    code: body.error.code,
    message: body.error.message,
    details: body.error.details,
  };
}

function isPostgresCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function createTestApp(pool: Pool, demoRegistrationEnabled = true): FastifyInstance {
  const app = buildApp({ readiness: { check: async () => undefined }, logger: false });
  registerFamilyRoutes(
    app,
    createFamilyService(pool, {
      cookieName: "fh_session",
      secureCookie: false,
      sessionTtlSeconds: 3_600,
    }),
    { allowedMutationOrigins: [webOrigin], demoRegistrationEnabled },
  );
  return app;
}

async function register(
  app: FastifyInstance,
  names: { displayName: string; familyName: string; profileName: string },
) {
  return app.inject({
    method: "POST",
    url: "/v1/demo/registrations",
    headers: { origin: webOrigin },
    payload: names,
  });
}

test("demo registration is atomic, strict, and stores only a session hash", async () => {
  const pool = createPool(loadConfig().databaseUrl);
  await migrateUp(pool);
  await pool.query("TRUNCATE users CASCADE");
  const app = createTestApp(pool);

  try {
    const response = await register(app, {
      displayName: "Synthetic Owner",
      familyName: "Synthetic Family",
      profileName: "Synthetic Profile",
    });
    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.equal(body.family.role, "owner");
    assert.equal(body.profile.kind, "adult");
    assert.equal(body.profile.familyId, body.family.id);

    const cookie = cookieFrom(response);
    assert.match(cookie.header, /; Path=\//);
    assert.match(cookie.header, /; HttpOnly/);
    assert.match(cookie.header, /; SameSite=Strict/);
    assert.match(cookie.header, /; Max-Age=3600/);
    assert.match(cookie.header, /; Expires=/);
    assert.doesNotMatch(cookie.header, /; Secure/);

    const stored = await pool.query<{ token_hash: string }>("SELECT token_hash FROM sessions");
    assert.match(stored.rows[0]?.token_hash ?? "", /^[0-9a-f]{64}$/);
    assert.equal(cookie.header.includes(stored.rows[0]?.token_hash ?? ""), false);

    const counts = await pool.query<{
      audits: string;
      families: string;
      memberships: string;
      profiles: string;
      sessions: string;
      users: string;
    }>(`SELECT
         (SELECT count(*) FROM users) AS users,
         (SELECT count(*) FROM sessions) AS sessions,
         (SELECT count(*) FROM families) AS families,
         (SELECT count(*) FROM family_memberships) AS memberships,
         (SELECT count(*) FROM patient_profiles) AS profiles,
         (SELECT count(*) FROM audit_events) AS audits`);
    assert.deepEqual(counts.rows[0], {
      audits: "3",
      families: "1",
      memberships: "1",
      profiles: "1",
      sessions: "1",
      users: "1",
    });

    const audit = await pool.query<{ action: string; metadata: Record<string, unknown> }>(
      "SELECT action, metadata FROM audit_events ORDER BY action",
    );
    assert.deepEqual(
      audit.rows.map(({ action }) => action),
      ["demo.session.created", "family.created", "profile.created"],
    );
    assert.equal(
      audit.rows.some(({ metadata }) => JSON.stringify(metadata).includes("Synthetic")),
      false,
    );

    const unknownField = await app.inject({
      method: "POST",
      url: "/v1/demo/registrations",
      headers: { origin: webOrigin },
      payload: {
        displayName: "Another owner",
        familyName: "Another family",
        profileName: "Another profile",
        userId: randomUUID(),
      },
    });
    assert.equal(unknownField.statusCode, 400);
    assert.equal(unknownField.json().error.code, "VALIDATION_ERROR");

    const untrustedOrigin = await app.inject({
      method: "POST",
      url: "/v1/demo/registrations",
      headers: { origin: "https://attacker.invalid" },
      payload: {
        displayName: "Blocked owner",
        familyName: "Blocked family",
        profileName: "Blocked profile",
      },
    });
    assert.equal(untrustedOrigin.statusCode, 403);
    assert.equal(untrustedOrigin.json().error.code, "ORIGIN_NOT_ALLOWED");

    const missingOrigin = await app.inject({
      method: "POST",
      url: "/v1/demo/registrations",
      payload: {
        displayName: "Blocked owner",
        familyName: "Blocked family",
        profileName: "Blocked profile",
      },
    });
    assert.equal(missingOrigin.statusCode, 403);
    assert.equal(missingOrigin.json().error.code, "ORIGIN_NOT_ALLOWED");

    const disabledApp = createTestApp(pool, false);
    const disabledDemo = await disabledApp.inject({
      method: "POST",
      url: "/v1/demo/registrations",
      headers: { origin: webOrigin },
      payload: {
        displayName: "Disabled owner",
        familyName: "Disabled family",
        profileName: "Disabled profile",
      },
    });
    assert.equal(disabledDemo.statusCode, 404);
    assert.equal(disabledDemo.json().error.code, "RESOURCE_NOT_FOUND");
    await disabledApp.close();

    const spoofedActor = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { "x-user-id": body.family.id },
    });
    assert.equal(spoofedActor.statusCode, 401);

    const unchanged = await pool.query<{ count: string }>("SELECT count(*) FROM users");
    assert.equal(unchanged.rows[0]?.count, "1");
  } finally {
    await app.close();
    await pool.end();
  }
});

test("registration failure rolls back user, tenant, profile, session, and audit", async () => {
  const pool = createPool(loadConfig().databaseUrl);
  await migrateUp(pool);
  await pool.query("TRUNCATE users CASCADE");
  const app = createTestApp(pool);
  await pool.query(`CREATE FUNCTION reject_test_profile() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'synthetic transaction failure';
    END;
  $$ LANGUAGE plpgsql`);
  await pool.query(`CREATE TRIGGER reject_test_profile
    BEFORE INSERT ON patient_profiles
    FOR EACH ROW EXECUTE FUNCTION reject_test_profile()`);

  try {
    const response = await register(app, {
      displayName: "Rollback Owner",
      familyName: "Rollback Family",
      profileName: "Rollback Profile",
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(errorShape(response), {
      statusCode: 500,
      code: "INTERNAL_ERROR",
      message: "The request could not be completed.",
      details: [],
    });
    const counts = await pool.query<{
      audits: string;
      families: string;
      profiles: string;
      sessions: string;
      users: string;
    }>(`SELECT
         (SELECT count(*) FROM users) AS users,
         (SELECT count(*) FROM sessions) AS sessions,
         (SELECT count(*) FROM families) AS families,
         (SELECT count(*) FROM patient_profiles) AS profiles,
         (SELECT count(*) FROM audit_events) AS audits`);
    assert.deepEqual(counts.rows[0], {
      audits: "0",
      families: "0",
      profiles: "0",
      sessions: "0",
      users: "0",
    });
  } finally {
    await pool.query("DROP TRIGGER reject_test_profile ON patient_profiles");
    await pool.query("DROP FUNCTION reject_test_profile()");
    await app.close();
    await pool.end();
  }
});

test("profile reads and writes are owner-only and cross-family requests do not disclose", async () => {
  const pool = createPool(loadConfig().databaseUrl);
  await migrateUp(pool);
  await pool.query("TRUNCATE users CASCADE");
  const app = createTestApp(pool);

  try {
    const first = await register(app, {
      displayName: "Synthetic Owner One",
      familyName: "Synthetic Family One",
      profileName: "Synthetic Profile One",
    });
    const second = await register(app, {
      displayName: "Synthetic Owner Two",
      familyName: "Synthetic Family Two",
      profileName: "Synthetic Profile Two",
    });
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    const firstBody = first.json();
    const secondBody = second.json();
    const firstCookie = cookieFrom(first).pair;
    const randomFamilyId = randomUUID();

    const ownSession = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: firstCookie },
    });
    assert.equal(ownSession.statusCode, 200);
    assert.deepEqual(ownSession.json().families[0].profiles, [firstBody.profile]);

    const foreignRead = await app.inject({
      method: "GET",
      url: `/v1/families/${secondBody.family.id}/profiles`,
      headers: { cookie: firstCookie },
    });
    const missingRead = await app.inject({
      method: "GET",
      url: `/v1/families/${randomFamilyId}/profiles`,
      headers: { cookie: firstCookie },
    });
    assert.deepEqual(errorShape(foreignRead), errorShape(missingRead));
    assert.equal(foreignRead.statusCode, 404);
    assert.equal(foreignRead.body.includes(secondBody.family.id), false);
    assert.equal(foreignRead.body.includes("Synthetic Family Two"), false);
    assert.equal(foreignRead.body.includes("Synthetic Profile Two"), false);

    const profileCountBefore = await pool.query<{ count: string }>(
      "SELECT count(*) FROM patient_profiles WHERE family_id = $1",
      [secondBody.family.id],
    );
    const foreignWrite = await app.inject({
      method: "POST",
      url: `/v1/families/${secondBody.family.id}/profiles`,
      headers: { cookie: firstCookie, origin: webOrigin },
      payload: { displayName: "Invisible Profile", kind: "dependent" },
    });
    const missingWrite = await app.inject({
      method: "POST",
      url: `/v1/families/${randomFamilyId}/profiles`,
      headers: { cookie: firstCookie, origin: webOrigin },
      payload: { displayName: "Invisible Profile", kind: "dependent" },
    });
    assert.deepEqual(errorShape(foreignWrite), errorShape(missingWrite));
    const profileCountAfter = await pool.query<{ count: string }>(
      "SELECT count(*) FROM patient_profiles WHERE family_id = $1",
      [secondBody.family.id],
    );
    assert.deepEqual(profileCountAfter.rows[0], profileCountBefore.rows[0]);

    for (const [displayName, kind] of [
      ["Synthetic Adult", "adult"],
      ["Synthetic Dependent", "dependent"],
    ] as const) {
      const created = await app.inject({
        method: "POST",
        url: `/v1/families/${firstBody.family.id}/profiles`,
        headers: { cookie: firstCookie, origin: webOrigin },
        payload: { displayName, kind },
      });
      assert.equal(created.statusCode, 201);
      assert.equal(created.json().profile.kind, kind);
    }

    const additionalAdult = await pool.query<{ linked_user_id: string | null }>(
      "SELECT linked_user_id FROM patient_profiles WHERE display_name = 'Synthetic Adult'",
    );
    assert.equal(additionalAdult.rows[0]?.linked_user_id, null);

    const ownerIds = await pool.query<{ family_id: string; user_id: string }>(
      `SELECT family_id, user_id
       FROM family_memberships
       WHERE role = 'owner'
       ORDER BY created_at, id`,
    );
    const firstOwner = ownerIds.rows.find(({ family_id }) => family_id === firstBody.family.id);
    const secondOwner = ownerIds.rows.find(({ family_id }) => family_id === secondBody.family.id);
    assert.ok(firstOwner);
    assert.ok(secondOwner);
    await assert.rejects(
      pool.query(
        `INSERT INTO patient_profiles
           (id, family_id, display_name, kind, created_by_user_id)
         VALUES ($1, $2, 'Cross tenant creator', 'dependent', $3)`,
        [randomUUID(), firstBody.family.id, secondOwner.user_id],
      ),
      (error: unknown) => isPostgresCode(error, "23503"),
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO patient_profiles
           (id, family_id, display_name, kind, linked_user_id, created_by_user_id)
         VALUES ($1, $2, 'Cross tenant link', 'adult', $3, $4)`,
        [randomUUID(), firstBody.family.id, secondOwner.user_id, firstOwner.user_id],
      ),
      (error: unknown) => isPostgresCode(error, "23503"),
    );
    const unlinkedUserId = randomUUID();
    await pool.query("INSERT INTO users (id, display_name) VALUES ($1, 'Unlinked test member')", [
      unlinkedUserId,
    ]);
    await pool.query(
      `INSERT INTO family_memberships (id, family_id, user_id, role, status)
       VALUES ($1, $2, $3, 'adult_member', 'active')`,
      [randomUUID(), firstBody.family.id, unlinkedUserId],
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO patient_profiles
           (id, family_id, display_name, kind, linked_user_id, created_by_user_id)
         VALUES ($1, $2, 'Linked dependent', 'dependent', $3, $4)`,
        [randomUUID(), firstBody.family.id, unlinkedUserId, firstOwner.user_id],
      ),
      (error: unknown) => isPostgresCode(error, "23514"),
    );
    await assert.rejects(
      pool.query("UPDATE families SET created_by_user_id = $1 WHERE id = $2", [
        secondOwner.user_id,
        firstBody.family.id,
      ]),
      (error: unknown) => isPostgresCode(error, "23503"),
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO audit_events
           (id, family_id, actor_user_id, action, resource_type, resource_id, result, correlation_id)
         VALUES ($1, $2, $3, 'cross.tenant', 'Family', $2, 'denied', 'synthetic-test')`,
        [randomUUID(), firstBody.family.id, secondOwner.user_id],
      ),
      (error: unknown) => isPostgresCode(error, "23503"),
    );

    await pool.query(
      `UPDATE family_memberships
       SET status = 'revoked', revoked_at = now()
       WHERE family_id = $1 AND user_id = $2`,
      [firstBody.family.id, firstOwner.user_id],
    );
    const revokedAccess = await app.inject({
      method: "GET",
      url: `/v1/families/${firstBody.family.id}/profiles`,
      headers: { cookie: firstCookie },
    });
    assert.equal(revokedAccess.statusCode, 404);
  } finally {
    await app.close();
    await pool.end();
  }
});

test("logout and session expiry fail closed", async () => {
  const pool = createPool(loadConfig().databaseUrl);
  await migrateUp(pool);
  await pool.query("TRUNCATE users CASCADE");
  const app = createTestApp(pool);

  try {
    const first = await register(app, {
      displayName: "Logout Owner",
      familyName: "Logout Family",
      profileName: "Logout Profile",
    });
    const firstCookie = cookieFrom(first).pair;
    const logout = await app.inject({
      method: "DELETE",
      url: "/v1/session",
      headers: { cookie: firstCookie, origin: webOrigin },
    });
    assert.equal(logout.statusCode, 204);
    assert.match(cookieFrom(logout).header, /Max-Age=0/);
    const loggedOut = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: firstCookie },
    });
    assert.equal(loggedOut.statusCode, 401);

    const second = await register(app, {
      displayName: "Expired Owner",
      familyName: "Expired Family",
      profileName: "Expired Profile",
    });
    const secondCookie = cookieFrom(second).pair;
    await pool.query(
      "UPDATE sessions SET expires_at = created_at + interval '1 microsecond' WHERE revoked_at IS NULL",
    );
    const expired = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: secondCookie },
    });
    assert.equal(expired.statusCode, 401);

    const third = await register(app, {
      displayName: "Disabled Owner",
      familyName: "Disabled Family",
      profileName: "Disabled Profile",
    });
    const thirdCookie = cookieFrom(third).pair;
    await pool.query(
      `UPDATE users
       SET disabled_at = now()
       WHERE id = (
         SELECT user_id FROM sessions
         WHERE expires_at > now() AND revoked_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )`,
    );
    const disabled = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: thirdCookie },
    });
    assert.equal(disabled.statusCode, 401);
  } finally {
    await app.close();
    await pool.end();
  }
});
