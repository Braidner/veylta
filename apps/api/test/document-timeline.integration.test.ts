import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { FastifyInstance } from "fastify";
import type { Database } from "../src/database/pool.js";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport, multipartFile } from "./confirmed-observations.js";
import type { Identity } from "./medical-profile-app.js";
import { register, webOrigin } from "./medical-profile-app.js";
import { createSyntheticImageOnlyPdf } from "./synthetic-image-only-pdf.js";
import { createSyntheticIntelligence } from "./synthetic-intelligence.js";
import { analyseSyntheticNote } from "./synthetic-note.js";

/**
 * A scanned report analysed today and left undecided — the queue's own document. Its bytes differ
 * from the text-layer fixture, so the upload is a document of its own rather than a reuse.
 */
async function queuedReport(
  app: FastifyInstance,
  database: Database,
  storageRoot: string,
  identity: Identity,
): Promise<{ documentId: string; factCount: number }> {
  const profilePath = `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
  const scan = createSyntheticImageOnlyPdf([
    "VEYLTA SYNTHETIC LAB REPORT v1",
    "SCANNED COPY - SYNTHETIC TEST DATA",
  ]);
  const multipart = multipartFile(scan, "queued-scan.pdf");
  const upload = await app.inject({
    method: "POST",
    url: `${profilePath}/documents`,
    headers: {
      cookie: identity.cookie,
      origin: webOrigin,
      "content-type": multipart.contentType,
      "idempotency-key": `upload-${randomUUID()}`,
    },
    payload: multipart.body,
  });
  assert.equal(upload.statusCode, 202, upload.body);
  const documentId = upload.json().document.id as string;
  const processed = await createDocumentExtractionProcessor({
    database,
    storage: createLocalObjectStorage(storageRoot),
    intelligence: createSyntheticIntelligence(),
  }).processNext({ workerId: `worker-${randomUUID()}`, leaseDurationMs: 60_000, retryDelayMs: 1 });
  assert.equal(processed.status, "completed");
  const facts = await app.inject({
    method: "GET",
    url: `${profilePath}/documents/${documentId}/facts`,
    headers: { cookie: identity.cookie },
  });
  assert.equal(facts.statusCode, 200, facts.body);
  return { documentId, factCount: (facts.json().items as unknown[]).length };
}

test("the timeline shows reviewed documents by effective date in whole-day pages with their counts; the queue stays out", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Timeline owner");
    const other = await register(app, "Timeline other");
    const base = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}`;
    const get = (query = "") =>
      app.inject({
        method: "GET",
        url: `${base}/documents/timeline${query}`,
        headers: { cookie: owner.cookie },
      });

    const empty = await get();
    assert.equal(empty.statusCode, 200, empty.body);
    assert.deepEqual(empty.json(), {
      contractVersion: "document-timeline/v1",
      entries: [],
      nextBefore: null,
    });

    // A reviewed report: confirm analyte a as printed, reject b — one confirmed observation.
    const report = await confirmSyntheticReport(app, database, storageRoot, owner, (factKey) =>
      factKey === "synthetic-analyte-a" ? "confirm" : "reject",
    );
    // The discharge note: zero facts, so its run completes at once; its own date is 2026-08-12.
    const note = await analyseSyntheticNote(app, database, storageRoot, owner);
    // One more report that stays in the queue: analysed, never decided.
    const queued = await queuedReport(app, database, storageRoot, owner);
    assert.equal(queued.factCount, 1, "the queued report has a fact nobody decided");

    const all = await get();
    const entries = all.json().entries as Array<{
      id: string;
      effectiveDate: { value: string; source: string };
      confirmedCount: number;
      outsideRangeCount: number;
      recordCount: number;
      title: string | null;
      category: string | null;
    }>;
    assert.deepEqual(
      entries.map((entry) => entry.id),
      [report.documentId, note.documentId],
      "the report (uploaded today) comes before the note (2026-08-12); the queued report stays out",
    );
    const [reportEntry, noteEntry] = entries;
    assert.equal(reportEntry?.effectiveDate.source, "upload");
    assert.equal(reportEntry?.confirmedCount, 1);
    assert.equal(
      reportEntry?.outsideRangeCount,
      0,
      "synthetic-analyte-a is 7.0 inside the printed 5.0–8.0 synthetic-unit",
    );
    assert.equal(reportEntry?.recordCount, 0);
    assert.deepEqual(noteEntry?.effectiveDate, { value: "2026-08-12", source: "document" });
    assert.equal(noteEntry?.confirmedCount, 0);
    assert.equal(all.json().nextBefore, null);

    // Confirm two of the note's records; the count follows.
    const records = await app.inject({
      method: "GET",
      url: `${base}/documents/${note.documentId}/clinician-records`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(records.statusCode, 200, records.body);
    const analysis = records.json() as {
      intelligenceResultId: string;
      items: Array<{ resultKey: string }>;
    };
    for (const { resultKey } of analysis.items.slice(0, 2)) {
      const decided = await app.inject({
        method: "PUT",
        url: `${base}/documents/${note.documentId}/clinician-records/${resultKey}`,
        headers: { cookie: owner.cookie, origin: webOrigin },
        payload: { intelligenceResultId: analysis.intelligenceResultId, decision: "confirm" },
      });
      assert.equal(decided.statusCode, 201, decided.body);
    }
    const withRecords = await get();
    assert.equal((withRecords.json().entries as Array<{ recordCount: number }>)[1]?.recordCount, 2);

    // Move the report to May: it sorts after the note and carries the person's source.
    const moved = await app.inject({
      method: "PUT",
      url: `${base}/documents/${report.documentId}/date`,
      headers: { cookie: owner.cookie, origin: webOrigin },
      payload: { documentDate: "2026-05-14" },
    });
    assert.equal(moved.statusCode, 200, moved.body);
    const reordered = await get();
    assert.deepEqual(
      (reordered.json().entries as Array<{ id: string }>).map((entry) => entry.id),
      [note.documentId, report.documentId],
    );
    assert.deepEqual(
      (reordered.json().entries as Array<{ effectiveDate: { value: string; source: string } }>).map(
        (entry) => entry.effectiveDate,
      ),
      [
        { value: "2026-08-12", source: "document" },
        { value: "2026-05-14", source: "person" },
      ],
    );

    // Whole-day pages: one day per page → two pages, the older reached through nextBefore.
    const first = await get("?limit=1");
    assert.equal((first.json().entries as unknown[]).length, 1);
    assert.equal(first.json().nextBefore, "2026-08-12");
    const second = await get(`?limit=1&before=${first.json().nextBefore}`);
    assert.deepEqual(
      (second.json().entries as Array<{ id: string }>).map((entry) => entry.id),
      [report.documentId],
    );
    assert.equal(second.json().nextBefore, null);

    for (const query of [
      "?limit=0",
      "?limit=51",
      "?limit=abc",
      "?before=2026-13-01",
      "?before=yesterday",
    ]) {
      const refused = await get(query);
      assert.ok(
        refused.statusCode === 400 || refused.statusCode === 422,
        `${query}: ${refused.statusCode}`,
      );
    }
    const stranger = await app.inject({
      method: "GET",
      url: `${base}/documents/timeline`,
      headers: { cookie: other.cookie },
    });
    assert.equal(stranger.statusCode, 404);

    const audit = await database.query<{ metadata: string; resource_type: string }>(
      `SELECT metadata, resource_type FROM audit_events
        WHERE family_id = $1 AND action = 'profile.timeline.opened'`,
      [owner.body.family.id],
    );
    assert.equal(audit.rows.length, 6, "one row per answered read, none for the refusals");
    for (const row of audit.rows) {
      assert.equal(row.resource_type, "PatientProfile");
      assert.deepEqual(JSON.parse(row.metadata), { contractVersion: "document-timeline/v1" });
    }
  } finally {
    await close();
  }
});
