import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assistantPath, startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { medicalProfilePath, register, webOrigin } from "./medical-profile-app.js";
import { analyseSyntheticNote } from "./synthetic-note.js";

test("confirmed records reach the assistant, are disclosed, and its сверка binds to them", async () => {
  const { app, database, storageRoot, scripted, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Check owner");
    const mutation = { cookie: owner.cookie, origin: webOrigin };
    for (const [kind, value] of [
      ["sex", "female"],
      ["birth_year", "1990"],
    ] as const) {
      const entry = await app.inject({
        method: "PUT",
        url: `${medicalProfilePath(owner)}/entries/${randomUUID()}`,
        headers: mutation,
        payload: { kind, value, recordedOn: null },
      });
      assert.equal(entry.statusCode, 201, entry.body);
    }
    await confirmSyntheticReport(app, database, storageRoot, owner);
    const { documentId, profilePath } = await analyseSyntheticNote(
      app,
      database,
      storageRoot,
      owner,
    );
    const path = `${profilePath}/documents/${documentId}/clinician-records`;
    const listed = await app.inject({
      method: "GET",
      url: path,
      headers: { cookie: owner.cookie },
    });
    const analysisId = listed.json().intelligenceResultId as string;
    const [diagnosis, medication] = listed.json().items as Array<{ resultKey: string }>;
    assert.ok(diagnosis && medication);
    const confirmed = await app.inject({
      method: "PUT",
      url: `${path}/${diagnosis.resultKey}`,
      headers: mutation,
      payload: { intelligenceResultId: analysisId, decision: "confirm" },
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
    const recordId = confirmed.json().item.record.id as string;
    const rejected = await app.inject({
      method: "PUT",
      url: `${path}/${medication.resultKey}`,
      headers: mutation,
      payload: { intelligenceResultId: analysisId, decision: "reject" },
    });
    assert.equal(rejected.statusCode, 201, rejected.body);

    // Only the confirmed record is disclosed and sent.
    const assistant = assistantPath(owner);
    const workspace = await app.inject({
      method: "GET",
      url: assistant,
      headers: { cookie: owner.cookie },
    });
    assert.equal(workspace.json().recordCount, 1);
    assert.equal(workspace.json().records[0].recordId, recordId);
    assert.equal(workspace.json().records[0].label, "Синтетический субклинический гипотиреоз");
    assert.equal(workspace.json().records[0].documentId, documentId);

    const created = await app.inject({
      method: "POST",
      url: `${assistant}/conversations`,
      headers: { ...mutation, "idempotency-key": `create-${randomUUID()}` },
      payload: { title: "Сверка" },
    });
    const conversationId = created.json().selectedConversationId as string;
    const acknowledged = await app.inject({
      method: "PUT",
      url: `${assistant}/conversations/${conversationId}/acknowledgement`,
      headers: mutation,
      payload: { acknowledgement: "send_confirmed_evidence_to_codex" },
    });
    assert.equal(acknowledged.statusCode, 200, acknowledged.body);
    const sent = await app.inject({
      method: "POST",
      url: `${assistant}/conversations/${conversationId}/messages`,
      headers: { ...mutation, "idempotency-key": `m-${randomUUID()}` },
      payload: { message: "Сверь записи врача с моими значениями." },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const prompt = scripted.turns[0]?.prompt ?? "";
    assert.match(prompt, /"clinicianRecords":\[\{"recordId":"/);
    assert.doesNotMatch(prompt, /Синтетический левотироксин/, "a rejected record never leaves");
    const answer = sent.json().messages.at(-1) as {
      answer: { blocks: Array<Record<string, unknown>> };
    };
    const check = answer.answer.blocks.find((block) => block.kind === "clinician_check");
    assert.ok(check, "the сверка block survives verification");
    assert.equal(check.claim, "differs");
    assert.deepEqual(check.theirs, { recordId });
    assert.equal(check.confirmWith, "endocrinologist");
  } finally {
    await close();
  }
});
