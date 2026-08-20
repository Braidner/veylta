import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { DocumentDetailResponse } from "@veylta/contracts";
import type { FastifyInstance } from "fastify";
import { labReportFixtureUrl, uploadDocument, withDocumentContext } from "./document-app.js";
import { type Identity, register } from "./family-app.js";
import { imagePageFixtureUrl, processOne, scriptedIntelligence } from "./image-page-support.js";

async function detail(
  app: FastifyInstance,
  owner: Identity,
  documentId: string,
): Promise<DocumentDetailResponse["document"]> {
  const response = await app.inject({
    method: "GET",
    url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as DocumentDetailResponse;
  assert.equal(body.contractVersion, "document/v9");
  return body.document;
}

test("the document says which pass read each page", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "PageReadings");
    const uploaded = await uploadDocument(
      app,
      owner,
      await readFile(imagePageFixtureUrl),
      "page-readings-upload",
    );
    const documentId = uploaded.json().document.id as string;

    await processOne(database, storageRoot, scriptedIntelligence().provider);

    assert.deepEqual((await detail(app, owner, documentId)).pages, [
      { pageNumber: 1, extractionMethod: "pdf_text_layer", unreadReason: null },
      { pageNumber: 2, extractionMethod: "codex_vision", unreadReason: null },
    ]);
  });
});

test("a page whose picture went unread carries the closed reason it was not read for", async () => {
  await withDocumentContext(async ({ app, database, storageRoot }) => {
    const owner = await register(app, "UnreadPage");
    const uploaded = await uploadDocument(
      app,
      owner,
      await readFile(imagePageFixtureUrl),
      "unread-page-upload",
    );
    const documentId = uploaded.json().document.id as string;

    await processOne(database, storageRoot, scriptedIntelligence({ refuseVision: true }).provider);

    assert.deepEqual((await detail(app, owner, documentId)).pages, [
      { pageNumber: 1, extractionMethod: "pdf_text_layer", unreadReason: null },
      { pageNumber: 2, extractionMethod: "pdf_text_layer", unreadReason: "vision_unavailable" },
    ]);
  });
});

test("a document nobody has analysed yet reports no pages at all", async () => {
  await withDocumentContext(async ({ app }) => {
    const owner = await register(app, "UnanalysedPages");
    const uploaded = await uploadDocument(
      app,
      owner,
      await readFile(labReportFixtureUrl),
      "unanalysed-pages-upload",
    );

    assert.deepEqual((await detail(app, owner, uploaded.json().document.id as string)).pages, []);
  });
});
