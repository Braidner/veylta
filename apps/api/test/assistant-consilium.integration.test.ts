import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assistantPath, startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { medicalProfilePath, register, webOrigin } from "./medical-profile-app.js";

// The консилиум end to end: the evidence names the specialists (a corrected ТТГ convenes the
// endocrinologist, a corrected гемоглобин the hematologist), every persona's opinion travels
// with the synthesis, the synthesis carries the highest urgency and the disagreement is shown,
// and a question addressed to one persona is answered by that persona alone.
test("the консилиум convenes from the evidence, keeps every opinion and the highest urgency", async () => {
  const { app, database, storageRoot, scripted, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Consilium owner");
    const path = assistantPath(owner);
    const mutation = (key: string) => ({
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": key,
    });
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
      factKey === "synthetic-analyte-a"
        ? {
            decision: "correct",
            correction: { sourceName: "ТТГ", sourceValue: "6.8", sourceUnit: "мМЕ/л" },
          }
        : {
            decision: "correct",
            correction: { sourceName: "Гемоглобин", sourceValue: "9.8", sourceUnit: "г/дл" },
          },
    );
    const workspace = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie: owner.cookie },
    });
    assert.equal(workspace.statusCode, 200, workspace.body);
    assert.deepEqual(
      workspace.json().consiliumPanel,
      [
        { specialty: "endocrinologist", observationIds: [seeded.observationIds[0]] },
        { specialty: "hematologist", observationIds: [seeded.observationIds[1]] },
      ],
      "the panel names who is invited and on which observations",
    );

    const created = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: mutation(`c-${randomUUID()}`),
      payload: { title: "Консилиум" },
    });
    assert.equal(created.statusCode, 201, created.body);
    const conversationId = created.json().selectedConversationId as string;
    const gated = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/consilium`,
      headers: mutation(`k-${randomUUID()}`),
      payload: { question: null },
    });
    assert.equal(gated.statusCode, 409, gated.body);
    assert.equal(gated.json().error.code, "ACKNOWLEDGEMENT_REQUIRED");
    const acknowledged = await app.inject({
      method: "PUT",
      url: `${path}/conversations/${conversationId}/acknowledgement`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_evidence_to_codex" },
    });
    assert.equal(acknowledged.statusCode, 200);

    const key = `k-${randomUUID()}`;
    const convened = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/consilium`,
      headers: mutation(key),
      payload: { question: "Что вы думаете все вместе?", specialties: ["cardiologist"] },
    });
    assert.equal(convened.statusCode, 201, convened.body);
    const messages = convened.json().messages as Array<Record<string, unknown>>;
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.text, "Что вы думаете все вместе?");
    const synthesis = messages[1] as {
      speaker: null;
      answer: { urgency: { tier: string } };
      consilium: {
        invitations: Array<{ specialty: string; observationIds: string[] }>;
        opinions: Array<{ specialty: string; answer: { urgency: { tier: string } } | null }>;
        agreements: Array<{ verdict: string; specialties: string[] }>;
      };
      exchanges: Array<{ stage: string; specialty: string | null }>;
    };
    assert.equal(synthesis.speaker, null);
    assert.deepEqual(
      synthesis.consilium.invitations.map((item) => item.specialty),
      ["endocrinologist", "hematologist", "cardiologist"],
      "the person's added specialty joins the deterministic panel",
    );
    assert.deepEqual(
      synthesis.consilium.opinions.map((item) => [item.specialty, item.answer?.urgency.tier]),
      [
        ["endocrinologist", "soon"],
        ["hematologist", "routine"],
        ["cardiologist", "routine"],
      ],
    );
    assert.equal(synthesis.answer.urgency.tier, "soon", "the highest opinion's urgency wins");
    assert.equal(synthesis.consilium.agreements[0]?.verdict, "differ");
    assert.equal(
      synthesis.exchanges.filter((item) => item.stage === "opinion").length,
      3,
      "one raw opinion per persona in the owner's journal",
    );
    assert.equal(synthesis.exchanges.filter((item) => item.stage === "synthesis").length, 1);
    assert.equal(
      scripted.turns.filter((turn) => turn.threadId === null).length,
      3 + 3 + 1 + 1,
      "opinions and checkers in their own threads, the synthesis opens the therapist's",
    );

    const replayed = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/consilium`,
      headers: mutation(key),
      payload: { question: "Что вы думаете все вместе?", specialties: ["cardiologist"] },
    });
    assert.equal(replayed.statusCode, 200);
    assert.equal(replayed.json().messages.length, 2);

    const asked = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(`m-${randomUUID()}`),
      payload: { message: "А что скажет эндокринолог отдельно?", addressee: "endocrinologist" },
    });
    assert.equal(asked.statusCode, 201, asked.body);
    const reply = asked.json().messages.at(-1) as {
      speaker: string;
      answer: { blocks: Array<{ kind: string; name?: string }> };
    };
    assert.equal(asked.json().messages.at(-2).addressee, "endocrinologist");
    assert.equal(reply.speaker, "endocrinologist");
    assert.equal(reply.answer.blocks[0]?.name, "Синтетический субклинический гипотиреоз");
    const persona = scripted.turns.at(-2);
    assert.match(persona?.prompt ?? "", /^Specialty: endocrinologist$/m);
    assert.equal(persona?.threadId, null, "a persona never resumes the therapist's thread");

    const followUp = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/messages`,
      headers: mutation(`m-${randomUUID()}`),
      payload: { message: "Спасибо, а теперь общий вывод?" },
    });
    assert.equal(followUp.statusCode, 201, followUp.body);
    const therapistTurns = scripted.turns.filter((turn) => {
      const schema = turn.schema as { properties: Record<string, unknown> };
      return (
        schema.properties.verdicts === undefined &&
        schema.properties.agreements === undefined &&
        !/^Specialty: /m.test(turn.prompt)
      );
    });
    assert.notEqual(
      therapistTurns.at(-1)?.threadId,
      null,
      "the therapist resumes the thread the synthesis opened",
    );
  } finally {
    await close();
  }
});

test("a консилиум with nobody to convene is refused before anything leaves", async () => {
  const { app, scripted, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Empty consilium owner");
    const path = assistantPath(owner);
    const created = await app.inject({
      method: "POST",
      url: `${path}/conversations`,
      headers: { cookie: owner.cookie, origin: webOrigin, "idempotency-key": `c-${randomUUID()}` },
      payload: { title: "Пусто" },
    });
    const conversationId = created.json().selectedConversationId as string;
    await app.inject({
      method: "PUT",
      url: `${path}/conversations/${conversationId}/acknowledgement`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { acknowledgement: "send_confirmed_evidence_to_codex" },
    });
    const empty = await app.inject({
      method: "POST",
      url: `${path}/conversations/${conversationId}/consilium`,
      headers: { cookie: owner.cookie, origin: webOrigin, "idempotency-key": `k-${randomUUID()}` },
      payload: { question: null },
    });
    assert.equal(empty.statusCode, 409);
    assert.equal(empty.json().error.code, "NOBODY_TO_CONVENE");
    assert.equal(scripted.turns.length, 0);
  } finally {
    await close();
  }
});
