import assert from "node:assert/strict";
import test from "node:test";
import { startAssistantApp } from "./assistant-app.js";
import { register, webOrigin } from "./medical-profile-app.js";
import { analyseSyntheticNote } from "./synthetic-note.js";

test("the clinician's statements of a note are listed with their fragments and decided one by one", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Records owner");
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
    assert.equal(listed.statusCode, 200, listed.body);
    const body = listed.json();
    assert.equal(body.contractVersion, "clinician-record/v1");
    assert.equal(body.documentDate, "2026-08-12");
    assert.match(body.intelligenceResultId, /^intelligence_[0-9a-f]{40}$/);
    assert.deepEqual(
      body.items.map(
        (item: { kind: string; extracted: { label: string; detail: string | null } }) => [
          item.kind,
          item.extracted.label,
          item.extracted.detail,
        ],
      ),
      [
        ["diagnosis", "Синтетический субклинический гипотиреоз", "E03.9"],
        ["medication", "Синтетический левотироксин", "25 мкг утром, 8 недель"],
        ["referral", "Консультация эндокринолога", "через 6 недель"],
        ["follow_up", "Повторить ТТГ и Т4 свободный", "через 6 недель"],
        ["finding", "Щитовидная железа не увеличена, узлов нет", "УЗИ синтетическое"],
      ],
    );
    assert.ok(body.items.every((item: { record: unknown }) => item.record === null));
    assert.equal(body.items[0].source.pageNumber, 1);
    assert.match(body.items[0].source.fragment, /^RECORD\|diagnosis\|/);
    const analysisId = body.intelligenceResultId as string;
    const keyOf = (index: number) => body.items[index].resultKey as string;

    // Confirm as extracted → 201; the same decision again → 200 with the same record.
    const mutation = { cookie: owner.cookie, origin: webOrigin };
    const confirmed = await app.inject({
      method: "PUT",
      url: `${path}/${keyOf(0)}`,
      headers: mutation,
      payload: { intelligenceResultId: analysisId, decision: "confirm" },
    });
    assert.equal(confirmed.statusCode, 201, confirmed.body);
    assert.equal(confirmed.json().item.record.decision, "confirmed");
    assert.equal(confirmed.json().item.record.label, "Синтетический субклинический гипотиреоз");
    const recordId = confirmed.json().item.record.id as string;
    const replay = await app.inject({
      method: "PUT",
      url: `${path}/${keyOf(0)}`,
      headers: mutation,
      payload: { intelligenceResultId: analysisId, decision: "confirm" },
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().item.record.id, recordId);

    // A decision is immutable: the opposite decision on the same statement is a conflict.
    const flip = await app.inject({
      method: "PUT",
      url: `${path}/${keyOf(0)}`,
      headers: mutation,
      payload: { intelligenceResultId: analysisId, decision: "reject" },
    });
    assert.equal(flip.statusCode, 409, flip.body);

    // Confirm with the person's own wording; reject another; a correction cannot reject.
    const corrected = await app.inject({
      method: "PUT",
      url: `${path}/${keyOf(1)}`,
      headers: mutation,
      payload: {
        intelligenceResultId: analysisId,
        decision: "confirm",
        correction: { label: "Синтетический левотироксин", detail: "25 мкг утром" },
      },
    });
    assert.equal(corrected.statusCode, 201, corrected.body);
    assert.equal(corrected.json().item.record.detail, "25 мкг утром");
    assert.equal(corrected.json().item.extracted.detail, "25 мкг утром, 8 недель");
    const rejected = await app.inject({
      method: "PUT",
      url: `${path}/${keyOf(4)}`,
      headers: mutation,
      payload: { intelligenceResultId: analysisId, decision: "reject" },
    });
    assert.equal(rejected.statusCode, 201, rejected.body);
    const rejectingCorrection = await app.inject({
      method: "PUT",
      url: `${path}/${keyOf(2)}`,
      headers: mutation,
      payload: {
        intelligenceResultId: analysisId,
        decision: "reject",
        correction: { label: "x", detail: null },
      },
    });
    assert.equal(rejectingCorrection.statusCode, 422, rejectingCorrection.body);

    // Bound to the analysis: another analysis id is a conflict; an unknown key is not found.
    const staleAnalysis = await app.inject({
      method: "PUT",
      url: `${path}/${keyOf(3)}`,
      headers: mutation,
      payload: { intelligenceResultId: `intelligence_${"0".repeat(40)}`, decision: "confirm" },
    });
    assert.equal(staleAnalysis.statusCode, 409, staleAnalysis.body);
    const unknownKey = await app.inject({
      method: "PUT",
      url: `${path}/no-such-record`,
      headers: mutation,
      payload: { intelligenceResultId: analysisId, decision: "confirm" },
    });
    assert.equal(unknownKey.statusCode, 404, unknownKey.body);

    // The list reads the decisions back; the audit row is payload-free.
    const again = await app.inject({ method: "GET", url: path, headers: { cookie: owner.cookie } });
    const decisions = again
      .json()
      .items.map((item: { record: { decision: string } | null }) => item.record?.decision ?? null);
    assert.deepEqual(decisions, ["confirmed", "confirmed", null, null, "rejected"]);
    const audit = await database.transaction((client) =>
      client.query<{ action: string; metadata: string }>(
        `SELECT action, metadata FROM audit_events WHERE resource_type = 'ClinicianRecord' ORDER BY created_at, rowid`,
      ),
    );
    assert.deepEqual(
      audit.rows.map((row) => row.action),
      [
        "review.clinician_record.confirmed",
        "review.clinician_record.confirmed",
        "review.clinician_record.rejected",
      ],
    );
    for (const row of audit.rows) {
      assert.doesNotMatch(row.metadata, /левотироксин|гипотиреоз/);
    }
  } finally {
    await close();
  }
});
