import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { carePlanPath, startAssistantApp } from "./assistant-app.js";
import { register, webOrigin } from "./medical-profile-app.js";

/** A calendar date `days` before today, in the canonical form the plan stores. */
function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

test("the person's check-ins on the regimen lanes: one mark per item and day, replaceable, bounded", async () => {
  const { app, database, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Checkin owner");
    const outsider = await register(app, "Checkin outsider");
    const path = carePlanPath(owner);
    const headers = { cookie: owner.cookie, origin: webOrigin };
    const createItem = async (category: string, title: string) => {
      const itemId = randomUUID();
      const created = await app.inject({
        method: "PUT",
        url: `${path}/items/${itemId}`,
        headers,
        payload: { category, title, note: null, scheduledFor: null },
      });
      assert.equal(created.statusCode, 201, created.body);
      assert.deepEqual(created.json().item.checkins, []);
      return itemId;
    };
    const walk = await createItem("activity", "Быстрая ходьба 3 раза в неделю");
    const visit = await createItem("clinician", "Получить допуск к нагрузке (кардиолог)");

    const today = daysAgo(0);
    const first = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/${today}`,
      headers,
      payload: { status: "done", note: "Прошла 30 минут, самочувствие хорошее" },
    });
    assert.equal(first.statusCode, 201, first.body);
    assert.equal(first.json().contractVersion, "home-care-plan/v2");
    const mark = first.json().item.checkins[0];
    assert.equal(mark.date, today);
    assert.equal(mark.status, "done");
    assert.equal(mark.note, "Прошла 30 минут, самочувствие хорошее");
    assert.match(mark.recordedAt, /^\d{4}-\d{2}-\d{2}T/);

    // The diary is the person's to correct: the same day again replaces the mark.
    const replaced = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/${today}`,
      headers,
      payload: { status: "skipped", note: null },
    });
    assert.equal(replaced.statusCode, 200, replaced.body);
    assert.deepEqual(
      replaced
        .json()
        .item.checkins.map((item: { date: string; status: string }) => [item.date, item.status]),
      [[today, "skipped"]],
    );
    const earlier = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/${daysAgo(2)}`,
      headers,
      payload: { status: "done", note: null },
    });
    assert.equal(earlier.statusCode, 201, earlier.body);

    const plan = await app.inject({ method: "GET", url: path, headers: { cookie: owner.cookie } });
    assert.equal(plan.statusCode, 200, plan.body);
    assert.equal(plan.json().contractVersion, "home-care-plan/v2");
    const items = plan.json().items as Array<{
      id: string;
      checkins: Array<{ date: string; status: string }>;
    }>;
    assert.deepEqual(
      items.find((item) => item.id === walk)?.checkins.map((item) => [item.date, item.status]),
      [
        [daysAgo(2), "done"],
        [today, "skipped"],
      ],
      "oldest first",
    );
    assert.deepEqual(items.find((item) => item.id === visit)?.checkins, []);

    // Only the regimen lanes take marks; only while the item is accepted; only within the window.
    const clinician = await app.inject({
      method: "PUT",
      url: `${path}/items/${visit}/checkins/${today}`,
      headers,
      payload: { status: "done", note: null },
    });
    assert.equal(clinician.statusCode, 422, clinician.body);
    const stale = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/${daysAgo(90)}`,
      headers,
      payload: { status: "done", note: null },
    });
    assert.equal(stale.statusCode, 422, stale.body);
    const future = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/${daysAgo(-3)}`,
      headers,
      payload: { status: "done", note: null },
    });
    assert.equal(future.statusCode, 422, future.body);
    const malformed = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/2026-13-40`,
      headers,
      payload: { status: "done", note: null },
    });
    assert.equal(malformed.statusCode, 422, malformed.body);
    const longNote = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/${today}`,
      headers,
      payload: { status: "done", note: "x".repeat(201) },
    });
    assert.equal(longNote.statusCode, 400, longNote.body);
    const badStatus = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/${today}`,
      headers,
      payload: { status: "partly", note: null },
    });
    assert.equal(badStatus.statusCode, 400, badStatus.body);

    const completed = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/state`,
      headers,
      payload: { revision: 1, state: "completed", scheduledFor: null },
    });
    assert.equal(completed.statusCode, 200, completed.body);
    assert.equal(completed.json().item.checkins.length, 2, "the state change keeps the marks");
    const afterCompletion = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/${today}`,
      headers,
      payload: { status: "done", note: null },
    });
    assert.equal(afterCompletion.statusCode, 409, afterCompletion.body);

    const stranger = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/${today}`,
      headers: { cookie: outsider.cookie, origin: webOrigin },
      payload: { status: "done", note: null },
    });
    assert.equal(stranger.statusCode, 404, "an outsider learns nothing");
    const noOrigin = await app.inject({
      method: "PUT",
      url: `${path}/items/${walk}/checkins/${today}`,
      headers: { cookie: owner.cookie },
      payload: { status: "done", note: null },
    });
    assert.equal(noOrigin.statusCode, 403);

    const audit = await database.query<{ action: string; metadata: string; resource_type: string }>(
      `SELECT action, metadata, resource_type FROM audit_events
        WHERE family_id = $1 AND action LIKE 'care_plan.checkin.%' ORDER BY created_at, rowid`,
      [owner.body.family.id],
    );
    assert.deepEqual(
      audit.rows.map((row) => row.action),
      ["care_plan.checkin.recorded", "care_plan.checkin.recorded", "care_plan.checkin.recorded"],
    );
    for (const row of audit.rows) {
      assert.equal(row.resource_type, "CarePlanItem");
      assert.deepEqual(JSON.parse(row.metadata), { contractVersion: "home-care-plan/v2" });
    }
  } finally {
    await close();
  }
});
