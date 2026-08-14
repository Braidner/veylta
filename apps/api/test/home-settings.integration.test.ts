import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createAccountService } from "../src/accounts/account-service.js";
import { registerAccountRoutes } from "../src/accounts/routes.js";
import { buildApp } from "../src/app.js";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";
import { createFamilyService } from "../src/family/family-service.js";
import { registerFamilyRoutes } from "../src/family/routes.js";
import {
  type CodexRuntimeProbe,
  createHomeSettingsService,
} from "../src/settings/home-settings-service.js";
import { registerHomeSettingsRoutes } from "../src/settings/routes.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { createObjectStorageKey } from "../src/storage/object-storage.js";
import { createLocalStorageController } from "../src/storage/storage-controller.js";

const webOrigin = "http://127.0.0.1:4300";

function cookie(response: {
  headers: Record<string, string | number | string[] | undefined>;
}): string {
  return String(response.headers["set-cookie"]).split(";", 1)[0] ?? "";
}

const codex: CodexRuntimeProbe = {
  async status() {
    return {
      installed: true,
      authenticated: true,
      authenticationMode: "chatgpt",
      daemonRunning: false,
      cliVersion: "codex-cli 0.test.0",
      runtimeVersion: null,
    };
  },
  async startDaemon() {
    return {
      installed: true,
      authenticated: true,
      authenticationMode: "chatgpt",
      daemonRunning: true,
      cliVersion: "codex-cli 0.test.0",
      runtimeVersion: "app-server 0.test.0",
    };
  },
};

test("administrator manages local accounts, Codex status, and verified storage relocation", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-home-settings-"));
  const oldRoot = join(root, "storage-old");
  const newRoot = join(root, "storage-new");
  const database = createDatabase(join(root, "test.sqlite"));
  await migrateUp(database);
  const storage = createLocalStorageController(database, oldRoot);
  await storage.initialize();
  const workerStorage = createLocalStorageController(database, oldRoot);
  await workerStorage.initialize();
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
  registerHomeSettingsRoutes(app, family, createHomeSettingsService(database, storage, codex), {
    allowedMutationOrigins: [webOrigin],
  });

  try {
    const setup = await app.inject({
      method: "POST",
      url: "/v1/setup",
      headers: { origin: webOrigin },
      payload: {
        username: "home-admin",
        password: "correct horse battery staple",
        displayName: "Домашний администратор",
      },
    });
    assert.equal(setup.statusCode, 201);
    const adminCookie = cookie(setup);
    const setupBody = setup.json() as { family: { id: string } };

    const settings = await app.inject({
      method: "GET",
      url: "/v1/settings",
      headers: { cookie: adminCookie },
    });
    assert.equal(settings.statusCode, 200);
    const settingsBody = settings.json() as {
      contractVersion: string;
      codex: unknown;
      storage: unknown;
      accounts: Array<Record<string, unknown>>;
    };
    assert.equal(settingsBody.accounts.length, 1);
    assert.match(String(settingsBody.accounts[0]?.id), /^[0-9a-f-]{36}$/);
    assert.deepEqual(
      {
        ...settingsBody,
        accounts: settingsBody.accounts.map(({ id: _id, ...account }) => account),
      },
      {
        contractVersion: "home-settings/v1",
        codex: {
          installed: true,
          authenticated: true,
          authenticationMode: "chatgpt",
          daemonRunning: false,
          cliVersion: "codex-cli 0.test.0",
          runtimeVersion: null,
          authenticationOwner: "codex_cli",
          experimental: true,
        },
        storage: {
          driver: "local",
          rootPath: oldRoot,
          state: "stable",
          targetRootPath: null,
          generation: 1,
          relocationSupported: true,
          lastFailureCode: null,
        },
        accounts: [
          {
            username: "home-admin",
            displayName: "Домашний администратор",
            role: "admin",
            status: "active",
          },
        ],
      },
    );

    const createdAccount = await app.inject({
      method: "POST",
      url: "/v1/settings/accounts",
      headers: { cookie: adminCookie, origin: webOrigin },
      payload: {
        username: "family-user",
        password: "another correct local password",
        displayName: "Пользователь семьи",
        role: "user",
      },
    });
    assert.equal(createdAccount.statusCode, 201);
    const accountBody = createdAccount.json() as {
      account: { id: string; username: string; role: string };
      profile: { familyId: string; displayName: string };
    };
    assert.equal(accountBody.account.username, "family-user");
    assert.equal(accountBody.account.role, "user");
    assert.equal(accountBody.profile.familyId, setupBody.family.id);
    assert.equal(accountBody.profile.displayName, "Пользователь семьи");
    assert.doesNotMatch(JSON.stringify(accountBody), /another correct|password_hash/i);

    const createdAdministrator = await app.inject({
      method: "POST",
      url: "/v1/settings/accounts",
      headers: { cookie: adminCookie, origin: webOrigin },
      payload: {
        username: "second-admin",
        password: "second administrator password",
        displayName: "Второй администратор",
        role: "admin",
      },
    });
    assert.equal(createdAdministrator.statusCode, 201);
    const administratorBody = createdAdministrator.json() as {
      account: { role: string };
      profile: { id: string; access: string };
    };
    assert.equal(administratorBody.account.role, "admin");
    assert.equal(administratorBody.profile.access, "owner");

    const administratorMembership = await database.query<{ role: string }>(
      `SELECT m.role
         FROM family_memberships m
         JOIN app_accounts a ON a.user_id = m.user_id
        WHERE a.username = 'second-admin'`,
    );
    assert.equal(administratorMembership.rows[0]?.role, "owner");

    const userLogin = await app.inject({
      method: "POST",
      url: "/v1/session",
      headers: { origin: webOrigin },
      payload: { username: "family-user", password: "another correct local password" },
    });
    assert.equal(userLogin.statusCode, 200);
    const userSession = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: cookie(userLogin) },
    });
    assert.equal(userSession.statusCode, 200);
    const userProfiles = (userSession.json() as { families: Array<{ profiles: unknown[] }> })
      .families[0]?.profiles;
    assert.equal(userProfiles?.length, 1);

    const administratorLogin = await app.inject({
      method: "POST",
      url: "/v1/session",
      headers: { origin: webOrigin },
      payload: { username: "second-admin", password: "second administrator password" },
    });
    assert.equal(administratorLogin.statusCode, 200);
    const administratorSession = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: cookie(administratorLogin) },
    });
    assert.equal(administratorSession.statusCode, 200);
    const administratorProfiles = (
      administratorSession.json() as {
        families: Array<{ profiles: Array<{ id: string; access: string }> }>;
      }
    ).families[0]?.profiles;
    assert.equal(administratorProfiles?.length, 3);
    assert.equal(administratorProfiles?.[0]?.id, administratorBody.profile.id);
    assert.deepEqual(
      administratorProfiles?.map((profile) => profile.access),
      ["owner", "owner", "owner"],
    );

    const denied = await app.inject({
      method: "GET",
      url: "/v1/settings",
      headers: { cookie: cookie(userLogin) },
    });
    assert.equal(denied.statusCode, 404);
    assert.doesNotMatch(denied.body, /home-admin|storage-old|codex-cli/i);

    const bytes = Buffer.from("%PDF-synthetic-settings");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const stagingKey = createObjectStorageKey(`staging/upload_${randomUUID()}`);
    const finalKey = createObjectStorageKey(`family_${setupBody.family.id}/sha256_${checksum}`);
    await storage.putStaging({
      key: stagingKey,
      body: Readable.from([bytes]),
      contentType: "application/pdf",
      maxBytes: 1024,
    });
    await storage.finalize(stagingKey, finalKey);
    await database.query(
      `INSERT INTO document_blobs
         (id, family_id, storage_contract_version, storage_key, content_type,
          byte_size, sha256)
       VALUES ($1, $2, 'object-storage/v1', $3, 'application/pdf', $4, $5)`,
      [randomUUID(), setupBody.family.id, finalKey, bytes.length, checksum],
    );

    const rejectedRelocation = await app.inject({
      method: "POST",
      url: "/v1/settings/storage/relocate",
      headers: { cookie: adminCookie, origin: webOrigin },
      payload: { rootPath: "relative/path" },
    });
    assert.equal(rejectedRelocation.statusCode, 422);
    assert.equal((await storage.status()).rootPath, oldRoot);

    const relocated = await app.inject({
      method: "POST",
      url: "/v1/settings/storage/relocate",
      headers: { cookie: adminCookie, origin: webOrigin },
      payload: { rootPath: newRoot },
    });
    assert.equal(relocated.statusCode, 200);
    assert.deepEqual((relocated.json() as { storage: unknown }).storage, {
      driver: "local",
      rootPath: newRoot,
      state: "stable",
      targetRootPath: null,
      generation: 2,
      relocationSupported: true,
      lastFailureCode: null,
    });
    const expected = { contentType: "application/pdf", byteSize: bytes.length, sha256: checksum };
    const relocatedObject = await storage.get(finalKey, expected);
    const relocatedChunks: Buffer[] = [];
    for await (const chunk of relocatedObject.body) relocatedChunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(relocatedChunks), bytes);
    const preservedObject = await createLocalObjectStorage(oldRoot).get(finalKey, expected);
    const preservedChunks: Buffer[] = [];
    for await (const chunk of preservedObject.body) preservedChunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(preservedChunks), bytes);

    const postRelocationBytes = Buffer.from("%PDF-created-after-relocation");
    const postRelocationSha = createHash("sha256").update(postRelocationBytes).digest("hex");
    const postRelocationStaging = createObjectStorageKey(`staging/upload_${randomUUID()}`);
    const postRelocationKey = createObjectStorageKey(
      `family_${setupBody.family.id}/sha256_${postRelocationSha}`,
    );
    await storage.putStaging({
      key: postRelocationStaging,
      body: Readable.from([postRelocationBytes]),
      contentType: "application/pdf",
      maxBytes: 1024,
    });
    await storage.finalize(postRelocationStaging, postRelocationKey);
    const refreshedWorkerObject = await workerStorage.get(postRelocationKey, {
      contentType: "application/pdf",
      byteSize: postRelocationBytes.length,
      sha256: postRelocationSha,
    });
    const refreshedWorkerChunks: Buffer[] = [];
    for await (const chunk of refreshedWorkerObject.body) {
      refreshedWorkerChunks.push(Buffer.from(chunk));
    }
    assert.deepEqual(Buffer.concat(refreshedWorkerChunks), postRelocationBytes);

    const started = await app.inject({
      method: "POST",
      url: "/v1/settings/codex/start",
      headers: { cookie: adminCookie, origin: webOrigin },
    });
    assert.equal(started.statusCode, 200);
    assert.equal(
      (started.json() as { codex: { daemonRunning: boolean } }).codex.daemonRunning,
      true,
    );
    const runtimeAudit = await database.query<{ action: string; metadata: string }>(
      "SELECT action, metadata FROM audit_events WHERE action = 'settings.codex.start'",
    );
    assert.equal(runtimeAudit.rowCount, 1);
    assert.deepEqual(JSON.parse(runtimeAudit.rows[0]?.metadata ?? "{}"), {
      contractVersion: "home-settings/v1",
    });
  } finally {
    await app.close();
    await database.close();
    await rm(root, { recursive: true, force: true });
  }
});
