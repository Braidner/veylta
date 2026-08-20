import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import { assistantPath, startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { type Identity, medicalProfilePath, register, webOrigin } from "./medical-profile-app.js";

async function readOverview(
  app: Awaited<ReturnType<typeof startAssistantApp>>["app"],
  owner: Identity,
): Promise<ProfileOverviewResponse> {
  const response = await app.inject({
    method: "GET",
    url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/overview`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as ProfileOverviewResponse;
}

test("the overview says what each assistant room last answered, and never what it said", async () => {
  const { app, database, storageRoot, scripted, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Overview assistants owner");
    const silent = await readOverview(app, owner);
    assert.deepEqual(silent.assistants, [], "a profile that never asked names no room");

    // A tier only exists for an answer the assistant could give: sex, birth year, one value.
    for (const [kind, value] of [
      ["sex", "female"],
      ["birth_year", "1990"],
    ] as const) {
      const entry = await app.inject({
        method: "PUT",
        url: `${medicalProfilePath(owner)}/entries/${randomUUID()}`,
        headers: { cookie: owner.cookie, origin: webOrigin },
        payload: { kind, value, recordedOn: null },
      });
      assert.equal(entry.statusCode, 201, entry.body);
    }
    await confirmSyntheticReport(app, database, storageRoot, owner, (factKey) =>
      factKey === "synthetic-analyte-a" ? "confirm" : "reject",
    );

    const path = assistantPath(owner);
    const mutation = (key: string) => ({
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": key,
    });
    const created = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(`create-${randomUUID()}`),
      payload: { title: "Мои анализы" },
    });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json().selectedConversationId as string;
    const acknowledged = await app.inject({
      method: "PUT",
      url: `${path}/conversations/${conversationId}/acknowledgement`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_evidence_to_codex" },
    });
    assert.equal(acknowledged.statusCode, 200, acknowledged.body);
    const answered = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(`m-${randomUUID()}`),
      payload: { message: "Что значат мои анализы?" },
    });
    assert.equal(answered.statusCode, 201, answered.body);
    const answeredAt = answered.json().messages[1].createdAt as string;

    const asked = await readOverview(app, owner);
    assert.deepEqual(
      asked.assistants,
      [{ assistantId: "physician", answeredAt, urgency: "routine", refused: false }],
      "only the room that answered is named, with the tier its answer carried",
    );

    scripted.fail.next = true;
    const failed = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(`m-${randomUUID()}`),
      payload: { message: "Ещё раз" },
    });
    assert.equal(failed.statusCode, 201, failed.body);
    assert.equal(failed.json().messages[3].refusal, "provider_unavailable");

    const refused = await readOverview(app, owner);
    assert.deepEqual(
      refused.assistants.map((item) => [item.assistantId, item.urgency, item.refused]),
      [["physician", null, true]],
      "the newest turn decides: a refusal carries no tier",
    );

    const audit = await database.transaction((client) =>
      client.query<{ metadata: string }>(
        `SELECT metadata FROM audit_events
          WHERE family_id = $1 AND resource_id = $2 AND action = 'profile.overview.opened'`,
        [owner.body.family.id, owner.body.profile.id],
      ),
    );
    assert.equal(audit.rows.length, 3, "every read is audited");
    for (const row of audit.rows) {
      assert.deepEqual(JSON.parse(row.metadata), { contractVersion: "profile-overview/v5" });
    }
    const recorded = JSON.stringify(audit.rows);
    assert.equal(recorded.includes("routine"), false, "no urgency reaches the audit row");
    assert.equal(recorded.includes("physician"), false, "no assistant id reaches the audit row");
  } finally {
    await close();
  }
});
