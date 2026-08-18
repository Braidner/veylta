import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { assistantPath, startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { medicalProfilePath, register, webOrigin } from "./medical-profile-app.js";
import { analyseSyntheticNote } from "./synthetic-note.js";

test("the outcome log: the clinician's word on a proposed block, latest wins, counted per room, never edited", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Outcome owner");
    const outsider = await register(app, "Outcome outsider");
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
    const recordsPath = `${profilePath}/documents/${documentId}/clinician-records`;
    const listed = await app.inject({
      method: "GET",
      url: recordsPath,
      headers: { cookie: owner.cookie },
    });
    const analysisId = listed.json().intelligenceResultId as string;
    const [diagnosis] = listed.json().items as Array<{ resultKey: string }>;
    assert.ok(diagnosis);
    const confirmedRecord = await app.inject({
      method: "PUT",
      url: `${recordsPath}/${diagnosis.resultKey}`,
      headers: mutation,
      payload: { intelligenceResultId: analysisId, decision: "confirm" },
    });
    assert.equal(confirmedRecord.statusCode, 201, confirmedRecord.body);
    const recordId = confirmedRecord.json().item.record.id as string;

    const assistant = assistantPath(owner);
    const empty = await app.inject({
      method: "GET",
      url: assistant,
      headers: { cookie: owner.cookie },
    });
    assert.equal(empty.json().contractVersion, "assistant/v7");
    assert.deepEqual(empty.json().outcomes, {
      counts: { confirmed: 0, rejected: 0, modified: 0 },
      checks: { agree: 0, differs: 0, cannot_assess: 0 },
      entries: [],
    });

    const created = await app.inject({
      method: "POST",
      url: `${assistant}/conversations`,
      headers: { ...mutation, "idempotency-key": `create-${randomUUID()}` },
      payload: { title: "Разбор" },
    });
    const conversationId = created.json().selectedConversationId as string;
    await app.inject({
      method: "PUT",
      url: `${assistant}/conversations/${conversationId}/acknowledgement`,
      headers: mutation,
      payload: { acknowledgement: "send_confirmed_evidence_to_codex" },
    });
    const sent = await app.inject({
      method: "POST",
      url: `${assistant}/conversations/${conversationId}/messages`,
      headers: { ...mutation, "idempotency-key": `m-${randomUUID()}` },
      payload: { message: "Что значат мои анализы?" },
    });
    assert.equal(sent.statusCode, 201, sent.body);
    const reply = sent.json().messages.at(-1) as {
      id: string;
      answer: { blocks: Array<{ kind: string }> };
      outcomes: unknown[];
    };
    assert.deepEqual(reply.outcomes, [], "an answer starts with no clinician's word on it");
    const hypothesisIndex = reply.answer.blocks.findIndex((block) => block.kind === "hypothesis");
    const checkIndex = reply.answer.blocks.findIndex((block) => block.kind === "clinician_check");
    const questionIndex = reply.answer.blocks.findIndex((block) => block.kind === "question");
    assert.ok(hypothesisIndex >= 0 && checkIndex >= 0 && questionIndex >= 0);
    const outcomePath = (blockIndex: number) =>
      `${assistant}/conversations/${conversationId}/messages/${reply.id}/blocks/${blockIndex}/outcome`;

    // The first word: modified, dated, tied to the confirmed record.
    const first = await app.inject({
      method: "PUT",
      url: outcomePath(hypothesisIndex),
      headers: mutation,
      payload: {
        verdict: "modified",
        decidedOn: "2026-08-10",
        note: "Врач подтвердил направление, но назвал другое состояние.",
        recordId,
      },
    });
    assert.equal(first.statusCode, 201, first.body);
    const marked = first.json().messages.at(-1) as {
      outcomes: Array<{ blockIndex: number; verdict: string; recordId: string | null }>;
    };
    assert.deepEqual(
      marked.outcomes.map((item) => [item.blockIndex, item.verdict, item.recordId]),
      [[hypothesisIndex, "modified", recordId]],
    );
    assert.deepEqual(first.json().outcomes.counts, { confirmed: 0, rejected: 0, modified: 1 });
    assert.deepEqual(first.json().outcomes.checks, { agree: 0, differs: 1, cannot_assess: 0 });
    const entry = first.json().outcomes.entries[0];
    assert.equal(entry.conversationId, conversationId);
    assert.equal(entry.conversationTitle, "Разбор");
    assert.equal(entry.messageId, reply.id);
    assert.equal(entry.blockKind, "hypothesis");
    assert.equal(entry.title, "Синтетическое состояние A");
    assert.equal(entry.decidedOn, "2026-08-10");

    // The same block again: the latest mark stands, the earlier one is kept.
    const second = await app.inject({
      method: "PUT",
      url: outcomePath(hypothesisIndex),
      headers: mutation,
      payload: { verdict: "confirmed", decidedOn: null, note: null, recordId: null },
    });
    assert.equal(second.statusCode, 200, second.body);
    assert.deepEqual(second.json().outcomes.counts, { confirmed: 1, rejected: 0, modified: 0 });
    assert.equal(second.json().outcomes.entries.length, 1);
    const stored = await database.query<{ verdict: string }>(
      `SELECT verdict FROM assistant_outcomes WHERE family_id = $1 ORDER BY recorded_at, rowid`,
      [owner.body.family.id],
    );
    assert.deepEqual(
      stored.rows.map((row) => row.verdict),
      ["modified", "confirmed"],
      "append-only",
    );

    // A сверка block takes the word too and shows its position as the title.
    const check = await app.inject({
      method: "PUT",
      url: outcomePath(checkIndex),
      headers: mutation,
      payload: { verdict: "rejected", decidedOn: "2026-08-12", note: null, recordId: null },
    });
    assert.equal(check.statusCode, 201, check.body);
    assert.deepEqual(check.json().outcomes.counts, { confirmed: 1, rejected: 1, modified: 0 });
    assert.equal(check.json().outcomes.entries[0].blockKind, "clinician_check");
    assert.match(check.json().outcomes.entries[0].title, /^По подтверждённым значениям/);

    // Bounds: not on a question, not past the answer, not on a stranger's record, not by others.
    const question = await app.inject({
      method: "PUT",
      url: outcomePath(questionIndex),
      headers: mutation,
      payload: { verdict: "confirmed", decidedOn: null, note: null, recordId: null },
    });
    assert.equal(question.statusCode, 422, question.body);
    const beyond = await app.inject({
      method: "PUT",
      url: outcomePath(reply.answer.blocks.length),
      headers: mutation,
      payload: { verdict: "confirmed", decidedOn: null, note: null, recordId: null },
    });
    assert.equal(beyond.statusCode, 422, beyond.body);
    const strangerRecord = await app.inject({
      method: "PUT",
      url: outcomePath(hypothesisIndex),
      headers: mutation,
      payload: {
        verdict: "confirmed",
        decidedOn: null,
        note: null,
        recordId: "00000000-0000-4000-8000-0000000000ff",
      },
    });
    assert.equal(strangerRecord.statusCode, 404, strangerRecord.body);
    const badDate = await app.inject({
      method: "PUT",
      url: outcomePath(hypothesisIndex),
      headers: mutation,
      payload: { verdict: "confirmed", decidedOn: "2026-13-40", note: null, recordId: null },
    });
    assert.equal(badDate.statusCode, 422, badDate.body);
    const badVerdict = await app.inject({
      method: "PUT",
      url: outcomePath(hypothesisIndex),
      headers: mutation,
      payload: { verdict: "maybe", decidedOn: null, note: null, recordId: null },
    });
    assert.equal(badVerdict.statusCode, 400, badVerdict.body);
    const stranger = await app.inject({
      method: "PUT",
      url: outcomePath(hypothesisIndex),
      headers: { cookie: outsider.cookie, origin: webOrigin },
      payload: { verdict: "confirmed", decidedOn: null, note: null, recordId: null },
    });
    assert.equal(stranger.statusCode, 404);
    const otherRoom = await app.inject({
      method: "PUT",
      url: outcomePath(hypothesisIndex).replace("/assistants/physician/", "/assistants/trainer/"),
      headers: mutation,
      payload: { verdict: "confirmed", decidedOn: null, note: null, recordId: null },
    });
    assert.equal(otherRoom.statusCode, 404, "a message id is a selector, not a key");

    const audit = await database.query<{ action: string; metadata: string; resource_type: string }>(
      `SELECT action, metadata, resource_type FROM audit_events
        WHERE family_id = $1 AND action = 'assistant.outcome.recorded' ORDER BY created_at, rowid`,
      [owner.body.family.id],
    );
    assert.equal(audit.rows.length, 3);
    for (const row of audit.rows) {
      assert.equal(row.resource_type, "AssistantOutcome");
      assert.deepEqual(JSON.parse(row.metadata), { contractVersion: "assistant/v7" });
    }
  } finally {
    await close();
  }
});
