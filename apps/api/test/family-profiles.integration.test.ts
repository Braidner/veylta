import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database, isSqliteConstraintError } from "../src/database/pool.js";
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

function createTestApp(database: Database, demoRegistrationEnabled = true): FastifyInstance {
  const app = buildApp({ readiness: { check: async () => undefined }, logger: false });
  registerFamilyRoutes(
    app,
    createFamilyService(database, {
      cookieName: "veylta_session",
      secureCookie: false,
      sessionTtlSeconds: 3_600,
    }),
    { allowedMutationOrigins: [webOrigin], demoRegistrationEnabled },
  );
  return app;
}

async function createTestContext(demoRegistrationEnabled = true): Promise<{
  app: FastifyInstance;
  close(): Promise<void>;
  database: Database;
}> {
  const root = await mkdtemp(join(tmpdir(), "veylta-family-test-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
    const app = createTestApp(database, demoRegistrationEnabled);
    return {
      app,
      database,
      async close() {
        await app.close();
        await database.close();
        await rm(root, { force: true, recursive: true });
      },
    };
  } catch (error) {
    await database.close();
    await rm(root, { force: true, recursive: true });
    throw error;
  }
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
  const context = await createTestContext();
  const { app, database } = context;

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

    const stored = await database.query<{ token_hash: string }>("SELECT token_hash FROM sessions");
    assert.match(stored.rows[0]?.token_hash ?? "", /^[0-9a-f]{64}$/);
    assert.equal(cookie.header.includes(stored.rows[0]?.token_hash ?? ""), false);

    const counts = await database.query<{
      audits: number;
      families: number;
      memberships: number;
      profiles: number;
      sessions: number;
      users: number;
    }>(`SELECT
         (SELECT count(*) FROM users) AS users,
         (SELECT count(*) FROM sessions) AS sessions,
         (SELECT count(*) FROM families) AS families,
         (SELECT count(*) FROM family_memberships) AS memberships,
         (SELECT count(*) FROM patient_profiles) AS profiles,
         (SELECT count(*) FROM audit_events) AS audits`);
    assert.deepEqual(
      { ...counts.rows[0] },
      {
        audits: 3,
        families: 1,
        memberships: 1,
        profiles: 1,
        sessions: 1,
        users: 1,
      },
    );

    const audit = await database.query<{ action: string; metadata: string }>(
      "SELECT action, metadata FROM audit_events ORDER BY action",
    );
    assert.deepEqual(
      audit.rows.map(({ action }) => action),
      ["demo.session.created", "family.created", "profile.created"],
    );
    const metadata = audit.rows.map((row) => JSON.parse(row.metadata));
    assert.equal(
      metadata.some((value) => JSON.stringify(value).includes("Synthetic")),
      false,
    );
    assert.equal(
      metadata.every((value) => value.contractVersion === "family-profile/v2"),
      true,
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

    const disabledApp = createTestApp(database, false);
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

    const unchanged = await database.query<{ count: number }>(
      "SELECT count(*) AS count FROM users",
    );
    assert.equal(unchanged.rows[0]?.count, 1);
  } finally {
    await context.close();
  }
});

test("an owner reads a paginated payload-free family audit log without a cross-family oracle", async () => {
  const context = await createTestContext();
  const { app, database } = context;

  try {
    const ownerRegistration = await register(app, {
      displayName: "Audit Owner",
      familyName: "Audit Family",
      profileName: "Audit Profile",
    });
    const outsiderRegistration = await register(app, {
      displayName: "Audit Outsider",
      familyName: "Other Audit Family",
      profileName: "Other Audit Profile",
    });
    assert.equal(ownerRegistration.statusCode, 201);
    assert.equal(outsiderRegistration.statusCode, 201);
    const owner = ownerRegistration.json();
    const ownerCookie = cookieFrom(ownerRegistration).pair;
    const outsiderCookie = cookieFrom(outsiderRegistration).pair;
    const session = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: ownerCookie },
    });
    assert.equal(session.statusCode, 200);
    const ownerUserId = session.json().user.id as string;

    for (const [index, result] of ["success", "denied", "failed"].entries()) {
      await database.query(
        `INSERT INTO audit_events
           (id, family_id, actor_user_id, action, resource_type, resource_id, result,
            correlation_id, metadata, created_at)
         VALUES ($1, $2, $3, $4, 'SyntheticResource', $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          owner.family.id,
          ownerUserId,
          `synthetic.audit.${index + 1}`,
          `resource-${index + 1}`,
          result,
          `correlation-secret-${index + 1}`,
          { secret: `audit-secret-${index + 1}` },
          `2099-01-0${index + 1}T00:00:00.000Z`,
        ],
      );
    }

    const first = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/audit-events?limit=2`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.headers["cache-control"], "no-store");
    assert.equal(first.rawPayload.includes("audit-secret-"), false);
    assert.equal(first.rawPayload.includes("correlation-secret-"), false);
    const firstPage = first.json() as {
      contractVersion: string;
      items: Array<{
        id: string;
        action: string;
        result: string;
        actor: { id: string; displayName: string };
        resource: { type: string; id: string };
        occurredAt: string;
      }>;
      nextCursor: string | null;
    };
    assert.equal(firstPage.contractVersion, "audit-log/v1");
    assert.equal(firstPage.items.length, 2);
    assert.equal(typeof firstPage.nextCursor, "string");
    assert.deepEqual(
      firstPage.items.map((item) => item.action),
      ["synthetic.audit.3", "synthetic.audit.2"],
    );
    assert.deepEqual(firstPage.items[0]?.resource, {
      type: "SyntheticResource",
      id: "resource-3",
    });
    assert.equal(firstPage.items[0]?.actor.displayName, "Audit Owner");
    assert.equal("metadata" in (firstPage.items[0] ?? {}), false);
    assert.equal("correlationId" in (firstPage.items[0] ?? {}), false);

    const second = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/audit-events?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().items[0].action, "synthetic.audit.1");

    const malformedCursor = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/audit-events?cursor=not-a-canonical-cursor`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(malformedCursor.statusCode, 422);
    assert.equal(malformedCursor.json().error.code, "DOMAIN_VALIDATION_ERROR");

    const unknownQuery = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/audit-events?unexpected=1`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(unknownQuery.statusCode, 400);

    const crossFamily = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/audit-events`,
      headers: { cookie: outsiderCookie },
    });
    assert.equal(crossFamily.statusCode, 404);
    assert.equal(crossFamily.rawPayload.includes("Audit Owner"), false);

    const outsiderSession = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: outsiderCookie },
    });
    assert.equal(outsiderSession.statusCode, 200);
    await database.query(
      `INSERT INTO family_memberships
         (id, family_id, user_id, role, status, created_at)
       VALUES ($1, $2, $3, 'caregiver', 'active', $4)`,
      [
        randomUUID(),
        owner.family.id,
        outsiderSession.json().user.id as string,
        "2098-12-31T00:00:00.000Z",
      ],
    );
    const ungrantedMember = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/audit-events`,
      headers: { cookie: outsiderCookie },
    });
    assert.equal(ungrantedMember.statusCode, 404);
    assert.equal(ungrantedMember.rawPayload.includes("Audit Owner"), false);

    const auditReads = await database.query<{ metadata: string }>(
      `SELECT metadata
         FROM audit_events
        WHERE family_id = $1 AND action = 'family.audit_log.opened'
        ORDER BY created_at, id`,
      [owner.family.id],
    );
    assert.equal(auditReads.rows.length, 2);
    assert.deepEqual(
      auditReads.rows.map((row) => JSON.parse(row.metadata)),
      [{ contractVersion: "audit-log/v1" }, { contractVersion: "audit-log/v1" }],
    );
  } finally {
    await context.close();
  }
});

test("registration failure rolls back user, tenant, profile, session, and audit", async () => {
  const context = await createTestContext();
  const { app, database } = context;
  await database.exec(`CREATE TRIGGER reject_test_profile
    BEFORE INSERT ON patient_profiles
    BEGIN
      SELECT RAISE(ABORT, 'synthetic transaction failure');
    END`);

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
    const counts = await database.query<{
      audits: number;
      families: number;
      profiles: number;
      sessions: number;
      users: number;
    }>(`SELECT
         (SELECT count(*) FROM users) AS users,
         (SELECT count(*) FROM sessions) AS sessions,
         (SELECT count(*) FROM families) AS families,
         (SELECT count(*) FROM patient_profiles) AS profiles,
         (SELECT count(*) FROM audit_events) AS audits`);
    assert.deepEqual(
      { ...counts.rows[0] },
      {
        audits: 0,
        families: 0,
        profiles: 0,
        sessions: 0,
        users: 0,
      },
    );
  } finally {
    await database.exec("DROP TRIGGER reject_test_profile");
    await context.close();
  }
});

test("profile reads and writes are owner-only and cross-family requests do not disclose", async () => {
  const context = await createTestContext();
  const { app, database } = context;

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

    const profileCountBefore = await database.query<{ count: number }>(
      "SELECT count(*) AS count FROM patient_profiles WHERE family_id = $1",
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
    const profileCountAfter = await database.query<{ count: number }>(
      "SELECT count(*) AS count FROM patient_profiles WHERE family_id = $1",
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

    const additionalAdult = await database.query<{ linked_user_id: string | null }>(
      "SELECT linked_user_id FROM patient_profiles WHERE display_name = 'Synthetic Adult'",
    );
    assert.equal(additionalAdult.rows[0]?.linked_user_id, null);

    const ownerIds = await database.query<{ family_id: string; user_id: string }>(
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
      database.query(
        `INSERT INTO patient_profiles
           (id, family_id, display_name, kind, created_by_user_id)
         VALUES ($1, $2, 'Cross tenant creator', 'dependent', $3)`,
        [randomUUID(), firstBody.family.id, secondOwner.user_id],
      ),
      (error: unknown) => isSqliteConstraintError(error, "foreign-key"),
    );
    await assert.rejects(
      database.query(
        `INSERT INTO patient_profiles
           (id, family_id, display_name, kind, linked_user_id, created_by_user_id)
         VALUES ($1, $2, 'Cross tenant link', 'adult', $3, $4)`,
        [randomUUID(), firstBody.family.id, secondOwner.user_id, firstOwner.user_id],
      ),
      (error: unknown) => isSqliteConstraintError(error, "foreign-key"),
    );
    const unlinkedUserId = randomUUID();
    await database.query(
      "INSERT INTO users (id, display_name) VALUES ($1, 'Unlinked test member')",
      [unlinkedUserId],
    );
    await database.query(
      `INSERT INTO family_memberships (id, family_id, user_id, role, status)
       VALUES ($1, $2, $3, 'adult_member', 'active')`,
      [randomUUID(), firstBody.family.id, unlinkedUserId],
    );
    await assert.rejects(
      database.query(
        `INSERT INTO patient_profiles
           (id, family_id, display_name, kind, linked_user_id, created_by_user_id)
         VALUES ($1, $2, 'Linked dependent', 'dependent', $3, $4)`,
        [randomUUID(), firstBody.family.id, unlinkedUserId, firstOwner.user_id],
      ),
      (error: unknown) => isSqliteConstraintError(error, "check"),
    );
    await assert.rejects(
      database.query("UPDATE families SET created_by_user_id = $1 WHERE id = $2", [
        secondOwner.user_id,
        firstBody.family.id,
      ]),
      (error: unknown) => isSqliteConstraintError(error, "foreign-key"),
    );
    await assert.rejects(
      database.query(
        `INSERT INTO audit_events
           (id, family_id, actor_user_id, action, resource_type, resource_id, result, correlation_id)
         VALUES ($1, $2, $3, 'cross.tenant', 'Family', $2, 'denied', 'synthetic-test')`,
        [randomUUID(), firstBody.family.id, secondOwner.user_id],
      ),
      (error: unknown) => isSqliteConstraintError(error, "foreign-key"),
    );

    await database.query(
      `UPDATE family_memberships
       SET status = 'revoked', revoked_at = $3
       WHERE family_id = $1 AND user_id = $2`,
      [firstBody.family.id, firstOwner.user_id, new Date()],
    );
    const revokedAccess = await app.inject({
      method: "GET",
      url: `/v1/families/${firstBody.family.id}/profiles`,
      headers: { cookie: firstCookie },
    });
    assert.equal(revokedAccess.statusCode, 404);
  } finally {
    await context.close();
  }
});

test("logout and session expiry fail closed", async () => {
  const context = await createTestContext();
  const { app, database } = context;

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
    const activeSession = await database.query<{ id: string }>(
      "SELECT id FROM sessions WHERE revoked_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1",
    );
    const expiredAt = new Date(Date.now() - 1_000);
    await database.query("UPDATE sessions SET created_at = $1, expires_at = $2 WHERE id = $3", [
      new Date(expiredAt.getTime() - 1_000),
      expiredAt,
      activeSession.rows[0]?.id,
    ]);
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
    await database.query(
      `UPDATE users
       SET disabled_at = $1
       WHERE id = (
         SELECT user_id FROM sessions
         WHERE expires_at > $2 AND revoked_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )`,
      [new Date(), new Date()],
    );
    const disabled = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: thirdCookie },
    });
    assert.equal(disabled.statusCode, 401);
  } finally {
    await context.close();
  }
});

test("an owner can issue a one-time local adult invitation without granting another profile", async () => {
  const context = await createTestContext();
  const { app, database } = context;

  try {
    const ownerRegistration = await register(app, {
      displayName: "Invitation Owner",
      familyName: "Invitation Family",
      profileName: "Owner Profile",
    });
    const unrelatedRegistration = await register(app, {
      displayName: "Invitation Outsider",
      familyName: "Other Invitation Family",
      profileName: "Other Profile",
    });
    assert.equal(ownerRegistration.statusCode, 201);
    assert.equal(unrelatedRegistration.statusCode, 201);
    const owner = ownerRegistration.json();
    const ownerCookie = cookieFrom(ownerRegistration).pair;
    const outsiderCookie = cookieFrom(unrelatedRegistration).pair;
    const ownerSession = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: ownerCookie },
    });
    assert.equal(ownerSession.statusCode, 200);
    const ownerUserId = ownerSession.json().user.id as string;

    const invitation = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/invitations`,
      headers: { cookie: ownerCookie, origin: webOrigin },
      payload: { role: "adult_member" },
    });
    assert.equal(invitation.statusCode, 201);
    const invitationBody = invitation.json() as {
      contractVersion: string;
      invitation: { id: string; familyId: string; role: string; code: string; expiresAt: string };
    };
    assert.equal(invitationBody.contractVersion, "family-invitation/v2");
    assert.equal(invitationBody.invitation.familyId, owner.family.id);
    assert.equal(invitationBody.invitation.role, "adult_member");
    assert.match(invitationBody.invitation.code, /^vi_[A-Za-z0-9_-]{43}$/);

    const crossFamilyCreation = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/invitations`,
      headers: { cookie: outsiderCookie, origin: webOrigin },
      payload: { role: "adult_member" },
    });
    assert.equal(crossFamilyCreation.statusCode, 404);
    assert.equal(crossFamilyCreation.rawPayload.includes("Invitation Owner"), false);

    const noOrigin = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/invitations`,
      headers: { cookie: ownerCookie },
      payload: { role: "adult_member" },
    });
    assert.equal(noOrigin.statusCode, 403);

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/demo/invitations/accept",
      headers: { origin: webOrigin },
      payload: {
        code: invitationBody.invitation.code,
        displayName: "Invited Adult",
        profileName: "Adult Profile",
      },
    });
    assert.equal(accepted.statusCode, 201);
    const joined = accepted.json() as {
      family: { id: string; role: string };
      profile: { id: string; familyId: string; kind: string };
    };
    assert.equal(joined.family.id, owner.family.id);
    assert.equal(joined.family.role, "adult_member");
    assert.equal(joined.profile.familyId, owner.family.id);
    assert.equal(joined.profile.kind, "adult");
    const memberCookie = cookieFrom(accepted).pair;

    const memberSession = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: memberCookie },
    });
    assert.equal(memberSession.statusCode, 200);
    assert.deepEqual(memberSession.json().families, [
      {
        ...joined.family,
        displayName: "Invitation Family",
        createdAt: owner.family.createdAt,
        profiles: [joined.profile],
      },
    ]);

    const ownProfiles = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/profiles`,
      headers: { cookie: memberCookie },
    });
    assert.equal(ownProfiles.statusCode, 200);
    assert.deepEqual(ownProfiles.json().items, [joined.profile]);

    const ownerProfiles = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/profiles`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(ownerProfiles.statusCode, 200);
    assert.equal(ownerProfiles.json().items.length, 2);

    const reused = await app.inject({
      method: "POST",
      url: "/v1/demo/invitations/accept",
      headers: { origin: webOrigin },
      payload: {
        code: invitationBody.invitation.code,
        displayName: "Second Adult",
        profileName: "Second Profile",
      },
    });
    assert.equal(reused.statusCode, 404);
    assert.equal(reused.rawPayload.includes("Invitation Family"), false);
    await assert.rejects(
      database.query("UPDATE family_invitations SET accepted_by_user_id = $1 WHERE id = $2", [
        ownerUserId,
        invitationBody.invitation.id,
      ]),
      (error: unknown) => isSqliteConstraintError(error, "trigger"),
    );

    const expiredCode = `vi_${"z".repeat(43)}`;
    const expiredAt = new Date(Date.now() - 1_000);
    await database.query(
      `INSERT INTO family_invitations
         (id, family_id, issued_by_user_id, token_hash, role, expires_at, created_at)
       VALUES ($1, $2, $3, $4, 'adult_member', $5, $6)`,
      [
        randomUUID(),
        owner.family.id,
        ownerUserId,
        createHash("sha256").update(expiredCode).digest("hex"),
        expiredAt,
        new Date(expiredAt.getTime() - 1_000),
      ],
    );
    const usersBeforeExpiredAcceptance = await database.query<{ count: number }>(
      "SELECT count(*) AS count FROM users",
    );
    const expired = await app.inject({
      method: "POST",
      url: "/v1/demo/invitations/accept",
      headers: { origin: webOrigin },
      payload: { code: expiredCode, displayName: "Expired Adult", profileName: "Expired Profile" },
    });
    assert.equal(expired.statusCode, 404);
    const usersAfterExpiredAcceptance = await database.query<{ count: number }>(
      "SELECT count(*) AS count FROM users",
    );
    assert.deepEqual(usersAfterExpiredAcceptance.rows, usersBeforeExpiredAcceptance.rows);

    const storedToken = await database.query<{ token_hash: string }>(
      "SELECT token_hash FROM family_invitations WHERE id = $1",
      [invitationBody.invitation.id],
    );
    assert.match(storedToken.rows[0]?.token_hash ?? "", /^[0-9a-f]{64}$/);
    assert.equal(storedToken.rows[0]?.token_hash === invitationBody.invitation.code, false);

    const events = await database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata
         FROM audit_events
        WHERE family_id = $1
          AND action IN ('family.invitation.created', 'family.invitation.accepted')
        ORDER BY action`,
      [owner.family.id],
    );
    assert.deepEqual(
      events.rows.map((event) => event.action),
      ["family.invitation.accepted", "family.invitation.created"],
    );
    assert.equal(
      events.rows.every(
        (event) =>
          JSON.parse(event.metadata).contractVersion === "family-invitation/v2" &&
          !event.metadata.includes(invitationBody.invitation.code),
      ),
      true,
    );
  } finally {
    await context.close();
  }
});

test("an owner grants and revokes explicit profile read access for an invited adult", async () => {
  const context = await createTestContext();
  const { app, database } = context;

  try {
    const ownerRegistration = await register(app, {
      displayName: "Consent Owner",
      familyName: "Consent Family",
      profileName: "Owner Profile",
    });
    const outsiderRegistration = await register(app, {
      displayName: "Consent Outsider",
      familyName: "Other Consent Family",
      profileName: "Other Profile",
    });
    assert.equal(ownerRegistration.statusCode, 201);
    assert.equal(outsiderRegistration.statusCode, 201);
    const owner = ownerRegistration.json();
    const ownerCookie = cookieFrom(ownerRegistration).pair;
    const outsiderCookie = cookieFrom(outsiderRegistration).pair;

    const dependent = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/profiles`,
      headers: { cookie: ownerCookie, origin: webOrigin },
      payload: { displayName: "Shared Dependent", kind: "dependent" },
    });
    assert.equal(dependent.statusCode, 201);
    const sharedProfile = dependent.json().profile as { id: string; familyId: string };

    const invitation = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/invitations`,
      headers: { cookie: ownerCookie, origin: webOrigin },
      payload: { role: "adult_member" },
    });
    assert.equal(invitation.statusCode, 201);
    const accepted = await app.inject({
      method: "POST",
      url: "/v1/demo/invitations/accept",
      headers: { origin: webOrigin },
      payload: {
        code: invitation.json().invitation.code,
        displayName: "Consent Adult",
        profileName: "Adult Personal Profile",
      },
    });
    assert.equal(accepted.statusCode, 201);
    const memberCookie = cookieFrom(accepted).pair;
    const memberSession = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: memberCookie },
    });
    assert.equal(memberSession.statusCode, 200);
    const memberUserId = memberSession.json().user.id as string;

    const memberCatalog = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/members`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(memberCatalog.statusCode, 200);
    assert.deepEqual(memberCatalog.json().items, [
      { id: memberUserId, displayName: "Consent Adult", role: "adult_member" },
    ]);

    const memberCatalogDenied = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/members`,
      headers: { cookie: memberCookie },
    });
    assert.equal(memberCatalogDenied.statusCode, 404);

    const noOrigin = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/profiles/${sharedProfile.id}/consent-grants`,
      headers: { cookie: ownerCookie },
      payload: { granteeUserId: memberUserId, capability: "profile.read" },
    });
    assert.equal(noOrigin.statusCode, 403);

    const granted = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/profiles/${sharedProfile.id}/consent-grants`,
      headers: { cookie: ownerCookie, origin: webOrigin },
      payload: { granteeUserId: memberUserId, capability: "profile.read" },
    });
    assert.equal(granted.statusCode, 201);
    const grant = granted.json() as {
      contractVersion: string;
      grant: {
        id: string;
        familyId: string;
        profileId: string;
        capability: string;
        grantee: { id: string; displayName: string; role: string };
        createdAt: string;
      };
    };
    assert.equal(grant.contractVersion, "profile-consent/v2");
    assert.equal(grant.grant.familyId, owner.family.id);
    assert.equal(grant.grant.profileId, sharedProfile.id);
    assert.equal(grant.grant.capability, "profile.read");
    assert.deepEqual(grant.grant.grantee, {
      id: memberUserId,
      displayName: "Consent Adult",
      role: "adult_member",
    });

    const duplicateGrant = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/profiles/${sharedProfile.id}/consent-grants`,
      headers: { cookie: ownerCookie, origin: webOrigin },
      payload: { granteeUserId: memberUserId, capability: "profile.read" },
    });
    assert.equal(duplicateGrant.statusCode, 409);

    const memberAfterGrant = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: memberCookie },
    });
    assert.equal(memberAfterGrant.statusCode, 200);
    assert.equal(
      memberAfterGrant
        .json()
        .families[0].profiles.some((profile: { id: string }) => profile.id === sharedProfile.id),
      true,
    );

    const listed = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/profiles/${sharedProfile.id}/consent-grants`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(listed.json().items, [grant.grant]);

    const outsiderSession = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: outsiderCookie },
    });
    assert.equal(outsiderSession.statusCode, 200);
    const crossFamilyGrant = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/profiles/${sharedProfile.id}/consent-grants`,
      headers: { cookie: ownerCookie, origin: webOrigin },
      payload: {
        granteeUserId: outsiderSession.json().user.id,
        capability: "profile.read",
      },
    });
    assert.equal(crossFamilyGrant.statusCode, 404);

    const revoked = await app.inject({
      method: "DELETE",
      url: `/v1/families/${owner.family.id}/profiles/${sharedProfile.id}/consent-grants/${grant.grant.id}`,
      headers: { cookie: ownerCookie, origin: webOrigin },
    });
    assert.equal(revoked.statusCode, 204);

    const memberAfterRevocation = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: memberCookie },
    });
    assert.equal(memberAfterRevocation.statusCode, 200);
    assert.equal(
      memberAfterRevocation
        .json()
        .families[0].profiles.some((profile: { id: string }) => profile.id === sharedProfile.id),
      false,
    );

    const events = await database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata
         FROM audit_events
        WHERE family_id = $1
          AND action LIKE 'profile.consent_%'
        ORDER BY action`,
      [owner.family.id],
    );
    assert.deepEqual(
      events.rows.map((event) => event.action),
      [
        "profile.consent_granted",
        "profile.consent_grants.opened",
        "profile.consent_members.opened",
        "profile.consent_revoked",
      ],
    );
    assert.equal(
      events.rows.every(
        (event) =>
          JSON.parse(event.metadata).contractVersion === "profile-consent/v2" &&
          !event.metadata.includes("Consent Adult"),
      ),
      true,
    );
  } finally {
    await context.close();
  }
});

test("a caregiver joins without an implicit profile and reads only an explicitly shared profile", async () => {
  const context = await createTestContext();
  const { app, database } = context;

  try {
    const ownerRegistration = await register(app, {
      displayName: "Caregiver Owner",
      familyName: "Caregiver Family",
      profileName: "Owner Profile",
    });
    assert.equal(ownerRegistration.statusCode, 201);
    const owner = ownerRegistration.json();
    const ownerCookie = cookieFrom(ownerRegistration).pair;

    const shared = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/profiles`,
      headers: { cookie: ownerCookie, origin: webOrigin },
      payload: { displayName: "Care Recipient", kind: "dependent" },
    });
    assert.equal(shared.statusCode, 201);
    const sharedProfile = shared.json().profile as { id: string };

    const invitation = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/invitations`,
      headers: { cookie: ownerCookie, origin: webOrigin },
      payload: { role: "caregiver" },
    });
    assert.equal(invitation.statusCode, 201);
    const invitationBody = invitation.json() as {
      contractVersion: string;
      invitation: { id: string; role: string; code: string };
    };
    assert.equal(invitationBody.contractVersion, "family-invitation/v2");
    assert.equal(invitationBody.invitation.role, "caregiver");

    const accepted = await app.inject({
      method: "POST",
      url: "/v1/demo/invitations/accept",
      headers: { origin: webOrigin },
      payload: { code: invitationBody.invitation.code, displayName: "Local Caregiver" },
    });
    assert.equal(accepted.statusCode, 201);
    const caregiver = accepted.json() as {
      family: { id: string; role: string };
      profile: null;
    };
    assert.equal(caregiver.family.id, owner.family.id);
    assert.equal(caregiver.family.role, "caregiver");
    assert.equal(caregiver.profile, null);
    const caregiverCookie = cookieFrom(accepted).pair;

    const caregiverSessionBeforeGrant = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: caregiverCookie },
    });
    assert.equal(caregiverSessionBeforeGrant.statusCode, 200);
    assert.deepEqual(caregiverSessionBeforeGrant.json().families[0].profiles, []);
    const caregiverUserId = caregiverSessionBeforeGrant.json().user.id as string;

    const consentMembers = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.family.id}/members`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(consentMembers.statusCode, 200);
    assert.deepEqual(consentMembers.json().items, [
      { id: caregiverUserId, displayName: "Local Caregiver", role: "caregiver" },
    ]);

    const grant = await app.inject({
      method: "POST",
      url: `/v1/families/${owner.family.id}/profiles/${sharedProfile.id}/consent-grants`,
      headers: { cookie: ownerCookie, origin: webOrigin },
      payload: { granteeUserId: caregiverUserId, capability: "profile.read" },
    });
    assert.equal(grant.statusCode, 201);
    assert.equal(grant.json().contractVersion, "profile-consent/v2");
    assert.equal(grant.json().grant.grantee.role, "caregiver");

    const caregiverSessionAfterGrant = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: caregiverCookie },
    });
    assert.equal(caregiverSessionAfterGrant.statusCode, 200);
    assert.deepEqual(caregiverSessionAfterGrant.json().families[0].profiles, [
      { ...shared.json().profile, access: "granted_read" },
    ]);

    const grantId = grant.json().grant.id as string;
    const revoked = await app.inject({
      method: "DELETE",
      url: `/v1/families/${owner.family.id}/profiles/${sharedProfile.id}/consent-grants/${grantId}`,
      headers: { cookie: ownerCookie, origin: webOrigin },
    });
    assert.equal(revoked.statusCode, 204);
    const caregiverSessionAfterRevocation = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: caregiverCookie },
    });
    assert.equal(caregiverSessionAfterRevocation.statusCode, 200);
    assert.deepEqual(caregiverSessionAfterRevocation.json().families[0].profiles, []);

    const caregiverRows = await database.query<{ profile_count: number }>(
      `SELECT count(*) AS profile_count
         FROM patient_profiles
        WHERE family_id = $1 AND linked_user_id = $2`,
      [owner.family.id, caregiverUserId],
    );
    assert.equal(caregiverRows.rows[0]?.profile_count, 0);
  } finally {
    await context.close();
  }
});
