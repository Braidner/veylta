import assert from "node:assert/strict";
import test from "node:test";
import { startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { register, webOrigin } from "./medical-profile-app.js";

test("the person corrects a document's date: the rule applies, 422/404 hold, the audit row is payload-free", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Date owner");
    const other = await register(app, "Date other");
    const { documentId } = await confirmSyntheticReport(app, database, storageRoot, owner);
    const base = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}`;
    const headers = { cookie: owner.cookie, origin: webOrigin };

    const before = await app.inject({
      method: "GET",
      url: base,
      headers: { cookie: owner.cookie },
    });
    assert.equal(before.json().contractVersion, "document/v8");
    assert.equal(before.json().document.effectiveDate.source, "upload");

    const corrected = await app.inject({
      method: "PUT",
      url: `${base}/date`,
      headers,
      payload: { documentDate: "2026-05-14" },
    });
    assert.equal(corrected.statusCode, 200, corrected.body);
    assert.deepEqual(corrected.json(), {
      contractVersion: "document/v8",
      documentId,
      effectiveDate: { value: "2026-05-14", source: "person" },
    });
    const after = await app.inject({ method: "GET", url: base, headers: { cookie: owner.cookie } });
    assert.deepEqual(after.json().document.effectiveDate, {
      value: "2026-05-14",
      source: "person",
    });

    const same = await app.inject({
      method: "PUT",
      url: `${base}/date`,
      headers,
      payload: { documentDate: "2026-05-14" },
    });
    assert.equal(same.statusCode, 200, "the same date again is a no-op");

    for (const [documentDate, status] of [
      ["2026-02-30", 422],
      ["14.05.2026", 422],
      ["2999-01-01", 422],
    ] as const) {
      const response = await app.inject({
        method: "PUT",
        url: `${base}/date`,
        headers,
        payload: { documentDate },
      });
      assert.equal(response.statusCode, status, `${documentDate}: ${response.body}`);
    }
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const edge = await app.inject({
      method: "PUT",
      url: `${base}/date`,
      headers,
      payload: { documentDate: tomorrow },
    });
    assert.equal(edge.statusCode, 200, "tomorrow is the latest allowed day");

    const cleared = await app.inject({
      method: "PUT",
      url: `${base}/date`,
      headers,
      payload: { documentDate: null },
    });
    assert.equal(cleared.statusCode, 200);
    assert.equal(cleared.json().effectiveDate.source, "upload");

    const stranger = await app.inject({
      method: "PUT",
      url: `${base}/date`,
      headers: { cookie: other.cookie, origin: webOrigin },
      payload: { documentDate: "2026-05-14" },
    });
    assert.equal(stranger.statusCode, 404);
    const unknown = await app.inject({
      method: "PUT",
      url: `${base.replace(documentId, "00000000-0000-4000-8000-000000000099")}/date`,
      headers,
      payload: { documentDate: "2026-05-14" },
    });
    assert.equal(unknown.statusCode, 404);
    const noOrigin = await app.inject({
      method: "PUT",
      url: `${base}/date`,
      headers: { cookie: owner.cookie },
      payload: { documentDate: "2026-05-14" },
    });
    assert.equal(noOrigin.statusCode, 403);

    const audit = await database.query<{ metadata: string }>(
      `SELECT metadata FROM audit_events WHERE family_id = $1 AND action = 'document.date.corrected'`,
      [owner.body.family.id],
    );
    assert.equal(
      audit.rows.length,
      3,
      "set, tomorrow, cleared — the no-op and the refusals are not audited",
    );
    for (const row of audit.rows) {
      assert.deepEqual(JSON.parse(row.metadata), { contractVersion: "document/v8" });
    }
  } finally {
    await close();
  }
});
