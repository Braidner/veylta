import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentDetailResponse, ProfileOverviewResponse } from "@veylta/contracts";
import { startAssistantApp } from "./assistant-app.js";
import { confirmSyntheticReport } from "./confirmed-observations.js";
import { register } from "./medical-profile-app.js";
import { analyseSyntheticNote } from "./synthetic-note.js";

/**
 * The effective date end to end: the laboratory fixture carries no «Дата:» line, so it falls back
 * to the upload day; the discharge note prints «Дата: 2026-08-12», so the document's own date wins.
 */
test("every document summary carries its effective date, and the overview counts the documents", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Effective date owner");
    const { profilePath, documentId: noteId } = await analyseSyntheticNote(
      app,
      database,
      storageRoot,
      owner,
    );
    const { documentId: reportId } = await confirmSyntheticReport(
      app,
      database,
      storageRoot,
      owner,
    );

    // The note prints its own date: the analysis supplies it, and `source` says so.
    const note = await app.inject({
      method: "GET",
      url: `${profilePath}/documents/${noteId}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(note.statusCode, 200, note.body);
    const noteBody = note.json() as DocumentDetailResponse;
    assert.equal(noteBody.contractVersion, "document/v8");
    assert.deepEqual(noteBody.document.effectiveDate, { value: "2026-08-12", source: "document" });

    // The laboratory fixture has no printed date: the upload day stands, as a UTC calendar day.
    const report = await app.inject({
      method: "GET",
      url: `${profilePath}/documents/${reportId}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(report.statusCode, 200, report.body);
    const reportBody = (report.json() as DocumentDetailResponse).document;
    assert.deepEqual(reportBody.effectiveDate, {
      value: reportBody.uploadedAt.slice(0, 10),
      source: "upload",
    });

    // A person's correction wins over both, and it is the same rule that the summary reads.
    await database.query(
      `UPDATE documents SET document_date_override = '2026-05-14' WHERE id = $1`,
      [noteId],
    );
    const corrected = await app.inject({
      method: "GET",
      url: `${profilePath}/documents/${noteId}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(corrected.statusCode, 200, corrected.body);
    assert.deepEqual((corrected.json() as DocumentDetailResponse).document.effectiveDate, {
      value: "2026-05-14",
      source: "person",
    });

    const overview = await app.inject({
      method: "GET",
      url: `${profilePath}/overview`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(overview.statusCode, 200, overview.body);
    const body = overview.json() as ProfileOverviewResponse;
    assert.equal(body.contractVersion, "profile-overview/v3");
    assert.equal(body.documentCount, 2, "both documents count, deleted ones would not");
    assert.equal(body.documentCount, body.recentDocuments.length);
    const overviewNote = body.recentDocuments.find((document) => document.id === noteId);
    const overviewReport = body.recentDocuments.find((document) => document.id === reportId);
    assert.deepEqual(overviewNote?.effectiveDate, { value: "2026-05-14", source: "person" });
    assert.deepEqual(overviewReport?.effectiveDate, {
      value: overviewReport?.uploadedAt.slice(0, 10),
      source: "upload",
    });
  } finally {
    await close();
  }
});
