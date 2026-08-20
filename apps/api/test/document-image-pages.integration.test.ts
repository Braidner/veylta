import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { labReportFixtureUrl, uploadDocument, withDocumentContext } from "./document-app.js";
import { register } from "./family-app.js";
import {
  imagePageFixtureUrl,
  pageProvenance,
  processOne,
  scriptedIntelligence,
} from "./image-page-support.js";
import { SYNTHETIC_VISION_TRANSCRIPTION } from "./synthetic-intelligence.js";

test("a picture page inside a text PDF is read by a second pass and stored as its transcription", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "ImagePage");
    const fixture = await readFile(imagePageFixtureUrl);
    const uploaded = await uploadDocument(app, owner, fixture, "image-page-upload");
    assert.equal(uploaded.statusCode, 202);
    const documentId = uploaded.json().document.id as string;
    const codex = scriptedIntelligence();

    const processed = await processOne(database, storageRoot, codex.provider);

    // The text pass read pages 1 and 2; only the picture page went to the second, image run.
    assert.deepEqual(codex.calls, ["text", "vision"]);
    assert.deepEqual(processed, { status: "completed", factCount: 3 });
    const pages = await pageProvenance(database, owner, documentId);
    assert.deepEqual(
      pages.map((page) => [page.page_number, page.extraction_method, page.unread_reason]),
      [
        [1, "pdf_text_layer", null],
        [2, "codex_vision", null],
      ],
    );
    assert.equal(pages[1]?.extracted_text, SYNTHETIC_VISION_TRANSCRIPTION);

    const facts = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}/facts`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(facts.statusCode, 200);
    // The picture page's own fact repeats a key page 1 already used; the repeat is settled
    // rather than dropped, and it cites the transcription of the page it was read from.
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

test("a document without a picture page is analyzed exactly once", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "TextOnly");
    const fixture = await readFile(labReportFixtureUrl);
    assert.equal((await uploadDocument(app, owner, fixture, "text-only-upload")).statusCode, 202);
    const codex = scriptedIntelligence();

    const processed = await processOne(database, storageRoot, codex.provider);

    // A silent second run would spend one more Codex call on every ordinary document.
    assert.deepEqual(codex.calls, ["text"]);
    assert.equal(processed.status, "completed");
  });
});

test("a refused second pass leaves the text pass's result and marks the page it never read", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "RefusedVision");
    const fixture = await readFile(imagePageFixtureUrl);
    const uploaded = await uploadDocument(app, owner, fixture, "refused-vision-upload");
    const documentId = uploaded.json().document.id as string;
    const codex = scriptedIntelligence({ refuseVision: true });

    const processed = await processOne(database, storageRoot, codex.provider);

    assert.deepEqual(codex.calls, ["text", "vision"]);
    assert.deepEqual(processed, { status: "completed", factCount: 2 });
    assert.deepEqual(
      (await pageProvenance(database, owner, documentId)).map((page) => [
        page.extraction_method,
        page.unread_reason,
      ]),
      [
        ["pdf_text_layer", null],
        ["pdf_text_layer", "vision_unavailable"],
      ],
    );
  });
});
