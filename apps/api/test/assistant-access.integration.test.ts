import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assistantPath, startAssistantApp } from "./assistant-app.js";
import { register, webOrigin } from "./medical-profile-app.js";

test("the assistant is profile-authorized (404 for strangers) and its audit trail is payload-free", async () => {
  const { app, database, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Assistant owner");
    const outsider = await register(app, "Assistant outsider");
    const path = assistantPath(owner);
    const created = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: { cookie: owner.cookie, origin: webOrigin, "idempotency-key": `c-${randomUUID()}` },
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
    const sent = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: { cookie: owner.cookie, origin: webOrigin, "idempotency-key": `m-${randomUUID()}` },
      payload: { message: "Что значат мои анализы?" },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const opened = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie: owner.cookie },
    });
    assert.equal(opened.statusCode, 200);

    for (const [method, url, payload] of [
      ["GET", path, undefined],
      ["GET", `${path}?conversationId=${conversationId}`, undefined],
      ["POST", `${path}/conversations`, { title: "Чужой" }],
      [
        "PUT",
        `${path}/conversations/${conversationId}/acknowledgement`,
        { acknowledgement: "send_confirmed_evidence_to_codex" },
      ],
      ["POST", `${path}/conversations/${conversationId}/messages`, { message: "Чужой" }],
    ] as const) {
      const foreign = await app.inject({
        method,
        url,
        headers: {
          cookie: outsider.cookie,
          origin: webOrigin,
          "idempotency-key": `x-${randomUUID()}`,
        },
        ...(payload === undefined ? {} : { payload }),
      });
      assert.equal(foreign.statusCode, 404, `${method} ${url}`);
    }
    const unknownConversation = await app.inject({
      method: "GET",
      url: `${path}?conversationId=${randomUUID()}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(unknownConversation.statusCode, 404);
    const untrustedOrigin = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: { cookie: owner.cookie, "idempotency-key": `m-${randomUUID()}` },
      payload: { message: "Без origin" },
    });
    assert.equal(untrustedOrigin.statusCode, 403);

    const audit = await database.transaction((client) =>
      client.query<{ action: string; metadata: string; resource_type: string }>(
        `SELECT action, metadata, resource_type FROM audit_events
          WHERE action LIKE 'profile.assistant.%' ORDER BY created_at`,
      ),
    );
    const actions = new Set(audit.rows.map((row) => row.action));
    for (const expected of [
      "profile.assistant.opened",
      "profile.assistant.conversation_created",
      "profile.assistant.egress_acknowledged",
      "profile.assistant.message_created",
    ]) {
      assert.ok(actions.has(expected), expected);
    }
    for (const row of audit.rows) {
      assert.equal(row.resource_type, "AssistantConversation");
      assert.deepEqual(JSON.parse(row.metadata), { contractVersion: "assistant/v6" });
    }
    const exchanges = await database.transaction((client) =>
      client.query<{ value: number }>(`SELECT count(*) AS value FROM assistant_exchanges`),
    );
    assert.equal(exchanges.rows[0]?.value, 1, "the raw turn is journaled, not audited");
  } finally {
    await close();
  }
});
