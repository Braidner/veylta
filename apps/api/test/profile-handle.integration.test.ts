import assert from "node:assert/strict";
import test from "node:test";
import { register, startMedicalProfileApp, webOrigin } from "./medical-profile-app.js";

test("handles: the session names them, an owner renames within the rule, uniqueness and reserved words hold", async () => {
  const { app, database, close } = await startMedicalProfileApp();
  try {
    const owner = await register(app, "Handle owner");
    const other = await register(app, "Handle other");
    const session = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: owner.cookie },
    });
    const profile = session.json().families[0].profiles[0];
    assert.equal(session.json().contractVersion, "family-profile/v3");
    assert.match(profile.handle, /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/);
    assert.equal(profile.handle, owner.body.profile.handle, "registration and session agree");

    const path = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/handle`;
    const headers = { cookie: owner.cookie, origin: webOrigin };
    const renamed = await app.inject({
      method: "PUT",
      url: path,
      headers,
      payload: { handle: "Anna-K" },
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.deepEqual(renamed.json(), {
      contractVersion: "family-profile/v3",
      profileId: owner.body.profile.id,
      handle: "anna-k",
    });
    const again = await app.inject({
      method: "GET",
      url: "/v1/session",
      headers: { cookie: owner.cookie },
    });
    assert.equal(again.json().families[0].profiles[0].handle, "anna-k");
    const stored = await database.query<{ handle_set_by: string }>(
      `SELECT handle_set_by FROM patient_profiles WHERE id = $1`,
      [owner.body.profile.id],
    );
    assert.equal(stored.rows[0]?.handle_set_by, "person");

    for (const [handle, status] of [
      ["login", 422],
      ["docs", 422],
      ["an", 422],
      ["anna_k", 422],
      ["anna-", 422],
      [other.body.profile.handle.toUpperCase(), 409],
    ] as const) {
      const response = await app.inject({ method: "PUT", url: path, headers, payload: { handle } });
      assert.equal(response.statusCode, status, `${handle}: ${response.body}`);
    }
    const same = await app.inject({
      method: "PUT",
      url: path,
      headers,
      payload: { handle: "anna-k" },
    });
    assert.equal(same.statusCode, 200, "the same handle again is a no-op");

    const stranger = await app.inject({
      method: "PUT",
      url: path,
      headers: { cookie: other.cookie, origin: webOrigin },
      payload: { handle: "stolen" },
    });
    assert.equal(stranger.statusCode, 404);
    const noOrigin = await app.inject({
      method: "PUT",
      url: path,
      headers: { cookie: owner.cookie },
      payload: { handle: "x-y-z" },
    });
    assert.equal(noOrigin.statusCode, 403);

    const audit = await database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata FROM audit_events WHERE family_id = $1 AND action = 'profile.handle.changed'`,
      [owner.body.family.id],
    );
    assert.equal(audit.rows.length, 1, "a no-op rename is not audited");
    assert.deepEqual(JSON.parse(audit.rows[0]?.metadata ?? "{}"), {
      contractVersion: "family-profile/v3",
    });
  } finally {
    await close();
  }
});
