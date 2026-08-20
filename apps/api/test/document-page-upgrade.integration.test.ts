import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isSqliteConstraintError } from "../src/database/pool.js";
import { uploadDocument, withDocumentContext } from "./document-app.js";
import { register } from "./family-app.js";
import {
  blindToPictures,
  imagePageFixtureUrl,
  pageProvenance,
  processOne,
  restartAnalysis,
  scriptedIntelligence,
} from "./image-page-support.js";
import { SYNTHETIC_VISION_TRANSCRIPTION } from "./synthetic-intelligence.js";

/** The caption the fixture prints on its picture page; nothing else on it is text. */
const pictureCaption = "Рисунок 1. Денситограмма (синтетическая кривая)";

function provenance(pages: Awaited<ReturnType<typeof pageProvenance>>): unknown[][] {
  return pages.map((page) => [page.page_number, page.extraction_method, page.unread_reason]);
}

test("a picture page read by nothing is upgraded when the document is analysed again", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "UpgradePicturePage");
    const uploaded = await uploadDocument(
      app,
      owner,
      await readFile(imagePageFixtureUrl),
      "page-upgrade-upload",
    );
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;

    // The document as an older Veylta stored it: the text pass could not tell a picture page
    // from any other, so page 2 holds its letterhead and nothing ever read the curve.
    const first = scriptedIntelligence();
    const before = await processOne(database, storageRoot, first.provider, {
      extractText: blindToPictures,
    });
    assert.deepEqual(before, { status: "completed", factCount: 2 });
    assert.deepEqual(first.calls, ["text"]);
    assert.deepEqual(provenance(await pageProvenance(database, owner, documentId)), [
      [1, "pdf_text_layer", null],
      [2, "pdf_text_layer", null],
    ]);

    await restartAnalysis(app, owner, documentId, "page-upgrade-restart");
    const second = scriptedIntelligence();

    const after = await processOne(database, storageRoot, second.provider);

    // Re-analysis is exactly how the second pass reaches a document analysed before it existed.
    assert.deepEqual(second.calls, ["text", "vision"]);
    assert.deepEqual(after, { status: "completed", factCount: 3 });
    const pages = await pageProvenance(database, owner, documentId);
    assert.deepEqual(provenance(pages), [
      [1, "pdf_text_layer", null],
      [2, "codex_vision", null],
    ]);
    assert.equal(pages[1]?.extracted_text, SYNTHETIC_VISION_TRANSCRIPTION);

    const facts = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}/facts`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(facts.statusCode, 200);
    assert.deepEqual(
      facts
        .json()
        .items.map((item: { factKey: string; source: { pageNumber: number } }) => [
          item.factKey,
          item.source.pageNumber,
        ]),
      [
        ["synthetic-analyte-a", 1],
        ["synthetic-analyte-b", 1],
        ["synthetic-analyte-a-2", 2],
      ],
    );
  });
});

test("a page a previous run read a fact from is never re-read and never rewritten", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "BoundPicturePage");
    const uploaded = await uploadDocument(
      app,
      owner,
      await readFile(imagePageFixtureUrl),
      "page-bound-upload",
    );
    const documentId = uploaded.json().document.id as string;

    // The first analysis read the caption on the picture page as a fact of its own.
    const first = scriptedIntelligence({ textFactLine: pictureCaption });
    assert.deepEqual(
      await processOne(database, storageRoot, first.provider, {
        extractText: blindToPictures,
      }),
      { status: "completed", factCount: 3 },
    );
    const stored = await pageProvenance(database, owner, documentId);
    assert.deepEqual(provenance(stored), [
      [1, "pdf_text_layer", null],
      [2, "pdf_text_layer", null],
    ]);

    await restartAnalysis(app, owner, documentId, "page-bound-restart");
    // This time the text pass reads nothing off the picture page, so only the stored fact of
    // the earlier run keeps page 2 from being handed to the second pass.
    const second = scriptedIntelligence();

    const after = await processOne(database, storageRoot, second.provider);

    assert.deepEqual(second.calls, ["text"]);
    assert.deepEqual(after, { status: "completed", factCount: 2 });
    assert.deepEqual(await pageProvenance(database, owner, documentId), stored);
  });
});

test("the database itself refuses to rewrite a page something was read from", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "PageRowTrigger");
    const uploaded = await uploadDocument(
      app,
      owner,
      await readFile(imagePageFixtureUrl),
      "page-trigger-upload",
    );
    const documentId = uploaded.json().document.id as string;
    await processOne(database, storageRoot, scriptedIntelligence().provider, {
      extractText: blindToPictures,
    });
    const familyId = owner.body.family.id;
    const rewrite = (pageNumber: number): Promise<unknown> =>
      database.query(
        `UPDATE document_pages SET extracted_text = $1, text_sha256 = $2
          WHERE family_id = $3 AND page_number = $4`,
        ["другой текст", "d".repeat(64), familyId, pageNumber],
      );

    // Page 1 printed the values this analysis read; page 2 is the picture nothing read.
    await assert.rejects(rewrite(1), (error: unknown) => isSqliteConstraintError(error, "trigger"));
    await rewrite(2);
    await assert.rejects(
      database.query(`UPDATE document_pages SET id = $1 WHERE family_id = $2 AND page_number = 2`, [
        randomUUID(),
        familyId,
      ]),
      (error: unknown) => isSqliteConstraintError(error, "trigger"),
    );

    const pages = await pageProvenance(database, owner, documentId);
    assert.equal(pages[0]?.extracted_text.includes("FACT|synthetic-analyte-a"), true);
    assert.equal(pages[1]?.extracted_text, "другой текст");
  });
});

test("the reason a page went unread moves both ways while nothing has been read from it", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "UnreadReason");
    const uploaded = await uploadDocument(
      app,
      owner,
      await readFile(imagePageFixtureUrl),
      "unread-reason-upload",
    );
    const documentId = uploaded.json().document.id as string;

    // Null: an older analysis that never looked for a picture page.
    await processOne(database, storageRoot, scriptedIntelligence().provider, {
      extractText: blindToPictures,
    });
    assert.deepEqual(provenance(await pageProvenance(database, owner, documentId)), [
      [1, "pdf_text_layer", null],
      [2, "pdf_text_layer", null],
    ]);

    // A closed reason: the second pass reached the page and was refused.
    await restartAnalysis(app, owner, documentId, "unread-reason-refused");
    const refused = scriptedIntelligence({ refuseVision: true });
    assert.equal((await processOne(database, storageRoot, refused.provider)).status, "completed");
    assert.deepEqual(provenance(await pageProvenance(database, owner, documentId)), [
      [1, "pdf_text_layer", null],
      [2, "pdf_text_layer", "vision_unavailable"],
    ]);

    // And back to null: the run after it never looked, so the page carries no reason again.
    await restartAnalysis(app, owner, documentId, "unread-reason-cleared");
    await processOne(database, storageRoot, scriptedIntelligence().provider, {
      extractText: blindToPictures,
    });
    assert.deepEqual(provenance(await pageProvenance(database, owner, documentId)), [
      [1, "pdf_text_layer", null],
      [2, "pdf_text_layer", null],
    ]);
  });
});
