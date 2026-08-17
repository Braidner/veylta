import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assistantPath, scriptedThreadId, startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { medicalProfilePath, register, webOrigin } from "./medical-profile-app.js";

test("the physician assistant: disclosure gate, evidence-bound turns, replay and the owner's journal", async () => {
  const { app, database, storageRoot, scripted, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Assistant owner");
    const path = assistantPath(owner);
    const mutation = (key: string) => ({
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": key,
    });

    const empty = await app.inject({ method: "GET", url: path, headers: { cookie: owner.cookie } });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.headers["cache-control"], "no-store");
    assert.deepEqual(empty.json(), {
      contractVersion: "assistant/v2",
      profileId: owner.body.profile.id,
      assistantId: "physician",
      canWrite: true,
      interpretationReady: false,
      evidenceCount: 0,
      evidence: [],
      consiliumPanel: [],
      conversations: [],
      selectedConversationId: null,
      messages: [],
    });

    const createKey = `create-${randomUUID()}`;
    const created = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(createKey),
      payload: { title: "Мои анализы" },
    });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json().selectedConversationId as string;
    assert.equal(created.json().conversations[0].acknowledged, false);
    const replayCreate = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(createKey),
      payload: { title: "Мои анализы" },
    });
    assert.equal(replayCreate.statusCode, 200);
    assert.equal(replayCreate.json().selectedConversationId, conversationId);
    const conflict = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(createKey),
      payload: { title: "Другой заголовок" },
    });
    assert.equal(conflict.statusCode, 409);
    const noKey = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { title: "Без ключа" },
    });
    assert.equal(noKey.statusCode, 400);
    assert.equal(noKey.json().error.code, "INVALID_IDEMPOTENCY_KEY");

    const gated = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(`m-${randomUUID()}`),
      payload: { message: "Что значат мои анализы?" },
    });
    assert.equal(gated.statusCode, 409, gated.body);
    assert.equal(gated.json().error.code, "ACKNOWLEDGEMENT_REQUIRED");
    assert.equal(scripted.turns.length, 0, "nothing leaves before the disclosure is confirmed");

    const wrongAcknowledgement = await app.inject({
      method: "PUT",
      url: `${path}/conversations/${conversationId}/acknowledgement`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_summary_to_codex" },
    });
    assert.equal(wrongAcknowledgement.statusCode, 400);
    const acknowledged = await app.inject({
      method: "PUT",
      url: `${path}/conversations/${conversationId}/acknowledgement`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_evidence_to_codex" },
    });
    assert.equal(acknowledged.statusCode, 200, acknowledged.body);
    assert.equal(acknowledged.json().conversations[0].acknowledged, true);

    const unready = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(`m-${randomUUID()}`),
      payload: { message: "Что значат мои анализы?" },
    });
    assert.equal(unready.statusCode, 201, unready.body);
    const firstAnswer = unready.json().messages[1];
    assert.equal(firstAnswer.role, "assistant");
    assert.equal(firstAnswer.refusal, null);
    assert.deepEqual(
      firstAnswer.answer.blocks.map((block: { kind: string }) => block.kind),
      ["missing", "missing"],
    );
    assert.equal(scripted.turns.length, 1, "a missing-only answer needs no checker");
    assert.equal(scripted.turns[0]?.threadId, null);

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
    const seeded = await confirmSyntheticReport(app, database, storageRoot, owner, (factKey) =>
      factKey === "synthetic-analyte-a" ? "confirm" : "reject",
    );
    assert.equal(seeded.observationIds.length, 1);
    const ready = await app.inject({ method: "GET", url: path, headers: { cookie: owner.cookie } });
    assert.equal(ready.json().interpretationReady, true);
    assert.equal(ready.json().evidenceCount, 1);
    assert.deepEqual(
      ready
        .json()
        .evidence.map((item: { observationId: string; documentId: string; pageNumber: number }) => [
          item.observationId,
          item.documentId,
          item.pageNumber,
        ]),
      [[seeded.observationIds[0], seeded.documentId, 1]],
      "every ref resolves to its source page",
    );

    const messageKey = `m-${randomUUID()}`;
    const answered = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(messageKey),
      payload: { message: "А теперь?" },
    });
    assert.equal(answered.statusCode, 201, answered.body);
    const messages = answered.json().messages as Array<Record<string, unknown>>;
    assert.equal(messages.length, 4);
    const second = messages[3] as {
      answer: {
        urgency: { tier: string };
        blocks: Array<{ kind: string; refs?: Array<{ observationId: string }> }>;
      };
      checker: unknown[];
      exchanges: Array<{ stage: string }>;
      provenance: { modelId: string; runtimeVersion: string };
      refusal: null;
    };
    assert.equal(second.refusal, null);
    assert.equal(second.answer.urgency.tier, "routine", "the checker's higher urgency wins");
    assert.deepEqual(
      second.answer.blocks.map((block) => block.kind),
      ["interpretation", "hypothesis", "question"],
    );
    assert.equal(second.answer.blocks[0]?.refs?.[0]?.observationId, seeded.observationIds[0]);
    assert.equal(second.checker.length, 3);
    assert.deepEqual(
      second.exchanges.map((item) => item.stage),
      ["answer", "checker"],
    );
    assert.equal(second.provenance.modelId, "gpt-test");
    assert.equal(scripted.turns.length, 3);
    assert.equal(scripted.turns[1]?.threadId, scriptedThreadId, "the second turn resumes");
    assert.match(scripted.turns[1]?.prompt ?? "", /Updated evidence/);
    assert.equal(scripted.turns[2]?.threadId, null, "the checker runs in its own thread");

    const replayed = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(messageKey),
      payload: { message: "А теперь?" },
    });
    assert.equal(replayed.statusCode, 200, replayed.body);
    assert.equal(replayed.json().messages.length, 4);
    assert.equal(scripted.turns.length, 3, "a replay never reaches the model again");
    const reused = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(messageKey),
      payload: { message: "Другой текст" },
    });
    assert.equal(reused.statusCode, 409);

    scripted.fail.next = true;
    const failed = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(`m-${randomUUID()}`),
      payload: { message: "Ещё раз" },
    });
    assert.equal(failed.statusCode, 201, failed.body);
    const refusal = failed.json().messages[5];
    assert.equal(refusal.refusal, "provider_unavailable");
    assert.equal(refusal.answer, null);
    assert.equal(refusal.exchanges[0].responseText, "");
    assert.equal(refusal.exchanges[0].runtimeVersion, null);
  } finally {
    await close();
  }
});
