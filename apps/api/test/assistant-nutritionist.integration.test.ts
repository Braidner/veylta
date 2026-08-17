import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assistantPath, startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { medicalProfilePath, register, webOrigin } from "./medical-profile-app.js";

test("the nutrition assistant: its own room, diet blocks verified like any answer, no personas", async () => {
  const { app, database, storageRoot, scripted, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Nutrition owner");
    const path = assistantPath(owner, "nutritionist");
    const mutation = (key: string) => ({
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": key,
    });

    const empty = await app.inject({ method: "GET", url: path, headers: { cookie: owner.cookie } });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.json().contractVersion, "assistant/v5");
    assert.equal(empty.json().assistantId, "nutritionist");
    assert.deepEqual(empty.json().consiliumPanel, [], "the консилиум is the physician's alone");
    const unknown = await app.inject({
      method: "GET",
      url: assistantPath(owner).replace(/physician$/, "dietitian"),
      headers: { cookie: owner.cookie },
    });
    assert.equal(unknown.statusCode, 400, "only the closed assistant ids resolve");

    for (const [kind, value] of [
      ["sex", "female"],
      ["birth_year", "1990"],
      ["medication", "Синтетический препарат B"],
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

    const created = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(`create-${randomUUID()}`),
      payload: { title: "Питание" },
    });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json().selectedConversationId as string;
    const physicianRoom = await app.inject({
      method: "GET",
      url: assistantPath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.deepEqual(
      physicianRoom.json().conversations,
      [],
      "a nutritionist conversation never shows in the physician's room",
    );
    const crossed = await app.inject({
      method: "PUT",
      url: `${assistantPath(owner)}/conversations/${conversationId}/acknowledgement`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_evidence_to_codex" },
    });
    assert.equal(crossed.statusCode, 404, "a conversation id is a selector, not a key");

    const acknowledged = await app.inject({
      method: "PUT",
      url: `${path}/conversations/${conversationId}/acknowledgement`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_evidence_to_codex" },
    });
    assert.equal(acknowledged.statusCode, 200, acknowledged.body);

    const persona = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(`m-${randomUUID()}`),
      payload: { message: "Что скажет кардиолог?", addressee: "cardiologist" },
    });
    assert.equal(persona.statusCode, 422, persona.body);
    const consilium = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/consilium`,
      headers: mutation(`c-${randomUUID()}`),
      payload: { question: null, specialties: [] },
    });
    assert.equal(consilium.statusCode, 422, consilium.body);
    assert.equal(scripted.turns.length, 0, "a refused request never reaches the model");

    const answered = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(`m-${randomUUID()}`),
      payload: { message: "Как мне питаться?" },
    });
    assert.equal(answered.statusCode, 201, answered.body);
    const messages = answered.json().messages as Array<Record<string, unknown>>;
    const reply = messages[1] as {
      answer: {
        urgency: { tier: string };
        blocks: Array<{
          kind: string;
          category?: string;
          interaction?: string;
          conflictNotes?: string | null;
          confirmWith?: string;
          when?: string;
          refs?: Array<{ observationId: string }>;
        }>;
      };
      checker: unknown[];
      exchanges: Array<{ stage: string }>;
      refusal: null;
    };
    assert.equal(reply.refusal, null);
    assert.equal(reply.answer.urgency.tier, "routine");
    assert.deepEqual(
      reply.answer.blocks.map((block) => block.kind),
      ["diet_assessment", "diet_recommendation", "diet_recommendation", "recheck", "question"],
    );
    const [, favour, supplement, recheck] = reply.answer.blocks;
    assert.equal(favour?.category, "favour");
    assert.equal(favour?.confirmWith, "dietitian");
    assert.equal(supplement?.category, "supplement");
    assert.equal(supplement?.interaction, "checked_conflict");
    assert.ok(supplement?.conflictNotes);
    assert.equal(recheck?.when, "через 3 месяца");
    assert.equal(recheck?.refs?.[0]?.observationId, seeded.observationIds[0]);
    assert.deepEqual(
      reply.exchanges.map((item) => item.stage),
      ["answer", "checker"],
    );
    assert.equal(reply.checker.length, 5);
    assert.equal(scripted.turns.length, 2);
    assert.match(
      scripted.turns[0]?.prompt ?? "",
      /nutrition assistant/,
      "the nutritionist speaks with its own preamble",
    );
    assert.match(scripted.turns[0]?.prompt ?? "", /"Синтетический препарат B"/);
    assert.equal(scripted.turns[1]?.threadId, null, "the checker runs in its own thread");
  } finally {
    await close();
  }
});
