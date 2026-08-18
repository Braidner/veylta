import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assistantPath, carePlanPath, startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { medicalProfilePath, register, webOrigin } from "./medical-profile-app.js";

test("the training assistant: its own room, activity blocks with clearance, progression built on the person's check-ins", async () => {
  const { app, database, storageRoot, scripted, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Trainer owner");
    const path = assistantPath(owner, "trainer");
    const mutation = (key: string) => ({
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": key,
    });

    const empty = await app.inject({ method: "GET", url: path, headers: { cookie: owner.cookie } });
    assert.equal(empty.statusCode, 200, empty.body);
    assert.equal(empty.json().contractVersion, "assistant/v7");
    assert.equal(empty.json().assistantId, "trainer");
    assert.deepEqual(empty.json().consiliumPanel, []);

    for (const [kind, value] of [
      ["sex", "male"],
      ["birth_year", "1985"],
      ["activity_constraint", "Не поднимать больше 10 кг после операции"],
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

    // An accepted activity item with three «done» marks: the trainer reads adherence, not plans.
    const walk = randomUUID();
    const created = await app.inject({
      method: "PUT",
      url: `${carePlanPath(owner)}/items/${walk}`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { category: "activity", title: "Быстрая ходьба", note: null, scheduledFor: null },
    });
    assert.equal(created.statusCode, 201, created.body);
    for (const daysAgo of [1, 3, 5]) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - daysAgo);
      const mark = await app.inject({
        method: "PUT",
        url: `${carePlanPath(owner)}/items/${walk}/checkins/${date.toISOString().slice(0, 10)}`,
        headers: { cookie: owner.cookie, origin: webOrigin },
        payload: { status: "done", note: daysAgo === 1 ? "Немного устал, но прошёл" : null },
      });
      assert.equal(mark.statusCode, 201, mark.body);
    }

    const conversation = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(`create-${randomUUID()}`),
      payload: { title: "Нагрузка" },
    });
    assert.equal(conversation.statusCode, 201, conversation.body);
    const conversationId = conversation.json().selectedConversationId as string;
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

    const answered = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(`m-${randomUUID()}`),
      payload: { message: "Как мне тренироваться?" },
    });
    assert.equal(answered.statusCode, 201, answered.body);
    const reply = answered.json().messages[1] as {
      answer: {
        urgency: { tier: string };
        blocks: Array<{
          kind: string;
          activityKind?: string;
          clearance?: string;
          progression?: string | null;
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
      [
        "activity_assessment",
        "activity_recommendation",
        "activity_recommendation",
        "activity_recommendation",
        "recheck",
      ],
    );
    const [, walkBlock, strength, avoid, recheck] = reply.answer.blocks;
    assert.equal(walkBlock?.activityKind, "aerobic");
    assert.equal(walkBlock?.clearance, "within");
    assert.equal(walkBlock?.confirmWith, "physiotherapist");
    assert.match(
      walkBlock?.progression ?? "",
      /через 4 недели/,
      "three done marks in the window let the scripted trainer progress",
    );
    assert.equal(strength?.clearance, "needs_clearance");
    assert.equal(strength?.confirmWith, "cardiologist");
    assert.ok(strength?.conflictNotes);
    assert.equal(avoid?.activityKind, "avoid");
    assert.equal(avoid?.progression, null);
    assert.equal(recheck?.when, "через 6 недель");
    assert.equal(recheck?.refs?.[0]?.observationId, seeded.observationIds[0]);
    assert.deepEqual(
      reply.exchanges.map((item) => item.stage),
      ["answer", "checker"],
    );
    assert.equal(reply.checker.length, 5);

    const opening = scripted.turns[0]?.prompt ?? "";
    assert.match(opening, /training assistant/, "the trainer speaks with its own preamble");
    assert.match(opening, /"Не поднимать больше 10 кг после операции"/);
    assert.match(
      opening,
      /"title":"Быстрая ходьба","state":"accepted","scheduledFor":null,"adherence":\{"days":28,"done":3,"skipped":0,"notes":\["Немного устал, но прошёл"\]\}/,
      "the accepted item travels with what the person actually did",
    );
    assert.equal(scripted.turns[1]?.threadId, null, "the checker runs in its own thread");
  } finally {
    await close();
  }
});
