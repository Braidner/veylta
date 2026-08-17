import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { startAssistantApp } from "./assistant-app.js";
import { multipartFile } from "./confirmed-observations.js";
import { register, webOrigin } from "./medical-profile-app.js";
import { createSyntheticIntelligence } from "./synthetic-intelligence.js";

const fixtureUrl = new URL("../../../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);

// An older extraction could store a reference range object with every field null. Such a
// fact must still be confirmable: the observation is created and simply carries no range —
// the database refuses an empty range row, and a person must never see a 500 for it.
test("confirming a fact whose stored reference range is empty creates the observation without a range", async () => {
  const { app, database, storageRoot, close } = await startAssistantApp();
  try {
    const owner = await register(app, "Empty range owner");
    const profilePath = `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}`;
    const multipart = multipartFile(await readFile(fixtureUrl));
    const upload = await app.inject({
      method: "POST",
      url: `${profilePath}/documents`,
      headers: {
        cookie: owner.cookie,
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
      intelligence: createSyntheticIntelligence({
        mapItems: (items) =>
          items.map((item) => ({
            ...item,
            referenceRange: {
              sourceText: null,
              sourceLow: null,
              sourceHigh: null,
              sourceUnit: null,
              laboratoryOutOfRange: null,
            },
          })),
      }),
    }).processNext({ workerId: `w-${randomUUID()}`, leaseDurationMs: 60_000, retryDelayMs: 1 });
    assert.equal(processed.status, "completed");

    const facts = await app.inject({
      method: "GET",
      url: `${profilePath}/documents/${documentId}/facts`,
      headers: { cookie: owner.cookie },
    });
    const fact = (facts.json().items as Array<{ id: string; factVersion: number }>)[0];
    assert.ok(fact !== undefined);
    const review = await app.inject({
      method: "POST",
      url: `${profilePath}/documents/${documentId}/facts/${fact.id}/review`,
      headers: { cookie: owner.cookie, origin: webOrigin, "idempotency-key": `r-${randomUUID()}` },
      payload: { factVersion: fact.factVersion, decision: "confirm" },
    });
    assert.equal(review.statusCode, 201, review.body);
    const ranges = await database.transaction((client) =>
      client.query<{ value: number }>(`SELECT count(*) AS value FROM observation_reference_ranges`),
    );
    assert.equal(ranges.rows[0]?.value, 0);
    const observations = await database.transaction((client) =>
      client.query<{ value: number }>(`SELECT count(*) AS value FROM observations`),
    );
    assert.equal(observations.rows[0]?.value, 1);
  } finally {
    await close();
  }
});
