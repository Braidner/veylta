import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAccountService } from "../src/accounts/account-service.js";
import { registerAccountRoutes } from "../src/accounts/routes.js";
import { buildApp } from "../src/app.js";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";

const webOrigin = "http://127.0.0.1:4300";

test("first launch atomically creates the only initial administrator and supports login", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-account-setup-"));
  const database = createDatabase(join(root, "test.sqlite"));
  await migrateUp(database);
  const app = buildApp({ readiness: { check: async () => undefined }, logger: false });
  const family = createFamilyService(database, {
    cookieName: "veylta_session",
    secureCookie: false,
    sessionTtlSeconds: 3_600,
  });
  registerAccountRoutes(
    app,
    createAccountService(database, {
      cookieName: "veylta_session",
      secureCookie: false,
      sessionTtlSeconds: 3_600,
    }),
    { allowedMutationOrigins: [webOrigin] },
  );
  registerFamilyRoutes(app, family, {
    allowedMutationOrigins: [webOrigin],
    demoRegistrationEnabled: false,
  });

  try {
    const statusBefore = await app.inject({ method: "GET", url: "/v1/setup" });
    assert.equal(statusBefore.statusCode, 200);
    assert.deepEqual(statusBefore.json(), {
      contractVersion: "account/v1",
      setupRequired: true,
    });
    assert.equal(statusBefore.headers["cache-control"], "no-store");

    const rejectedWithoutOrigin = await app.inject({
      method: "POST",
      url: "/v1/setup",
      payload: {
        username: "home-admin",
        password: "correct horse battery staple",
        displayName: "Домашний администратор",
      },
    });
    assert.equal(rejectedWithoutOrigin.statusCode, 403);

    const created = await app.inject({
      method: "POST",
      url: "/v1/setup",
      headers: { origin: webOrigin },
      payload: {
        username: "home-admin",
        password: "correct horse battery staple",
        displayName: "Домашний администратор",
      },
    });
    assert.equal(created.statusCode, 201);
    const createdBody = created.json() as {
      contractVersion: string;
      user: { id: string; username: string; displayName: string; role: string };
      family: { id: string };
      profile: { id: string; familyId: string; displayName: string; access: string };
    };
    assert.deepEqual(
      {
        contractVersion: createdBody.contractVersion,
        username: createdBody.user.username,
        displayName: createdBody.user.displayName,
        role: createdBody.user.role,
        profileFamilyId: createdBody.profile.familyId,
        familyId: createdBody.family.id,
        profileName: createdBody.profile.displayName,
        access: createdBody.profile.access,
      },
      {
        contractVersion: "account/v1",
        username: "home-admin",
        displayName: "Домашний администратор",
        role: "admin",
        profileFamilyId: createdBody.family.id,
        familyId: createdBody.family.id,
        profileName: "Домашний администратор",
        access: "owner",
      },
    );
    assert.ok(typeof created.headers["set-cookie"] === "string");
    assert.doesNotMatch(JSON.stringify(createdBody), /correct horse|password|hash/i);

    const accounts = await database.query<{
      username: string;
      role: string;
      password_hash: string;
    }>("SELECT username, role, password_hash FROM app_accounts");
    assert.equal(accounts.rowCount, 1);
    assert.equal(accounts.rows[0]?.username, "home-admin");
    assert.equal(accounts.rows[0]?.role, "admin");
    assert.match(accounts.rows[0]?.password_hash ?? "", /^scrypt-v1\$/);
    assert.doesNotMatch(accounts.rows[0]?.password_hash ?? "", /correct horse/);

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/setup",
      headers: { origin: webOrigin },
      payload: {
        username: "second-admin",
        password: "another correct home password",
        displayName: "Второй администратор",
      },
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(
      (await database.query<{ count: number }>("SELECT count(*) AS count FROM app_accounts"))
        .rows[0]?.count,
      1,
    );

    const statusAfter = await app.inject({ method: "GET", url: "/v1/setup" });
    assert.deepEqual(statusAfter.json(), {
      contractVersion: "account/v1",
      setupRequired: false,
    });

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/v1/session",
      headers: { origin: webOrigin },
      payload: { username: "home-admin", password: "this password is wrong" },
    });
    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(
      (wrongPassword.json() as { error: { code: string } }).error.code,
      "INVALID_CREDENTIALS",
    );

    const login = await app.inject({
      method: "POST",
      url: "/v1/session",
      headers: { origin: webOrigin },
      payload: {
        username: "HOME-ADMIN",
        password: "correct horse battery staple",
      },
    });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers["set-cookie"]).split(";", 1)[0];
    const session = await app.inject({ method: "GET", url: "/v1/session", headers: { cookie } });
    assert.equal(session.statusCode, 200);
    assert.deepEqual((session.json() as { user: unknown }).user, {
      id: createdBody.user.id,
      username: "home-admin",
      displayName: "Домашний администратор",
      role: "admin",
    });
  } finally {
    await app.close();
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
});
