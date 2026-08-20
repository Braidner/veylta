import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_SYNTHETIC_DOCUMENT_BYTES } from "@veylta/contracts";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";
import { uploadDocument, withDocumentContext } from "./document-app.js";
import { register } from "./family-app.js";
import { reapplyFrom, rollbackTo } from "./migration-chain.js";

/** The ceiling before 0040; a document just past it is the smallest proof the bound moved. */
const PREVIOUS_DOCUMENT_CEILING = 5 * 1024 * 1024;

/** Every column that records how many bytes one uploaded source had. */
const BYTE_SIZE_COLUMNS = [
  { table: "document_blobs", column: "byte_size" },
  { table: "document_upload_requests", column: "request_byte_size" },
  { table: "document_upload_reuse_requests", column: "request_byte_size" },
] as const;

function syntheticPdf(byteSize: number): Buffer {
  const head = Buffer.from("%PDF-1.7\n% VEYLTA SYNTHETIC ONLY\n", "utf8");
  const tail = Buffer.from("\n%%EOF\n", "utf8");
  return Buffer.concat([
    head,
    Buffer.alloc(byteSize - head.byteLength - tail.byteLength, 0x53),
    tail,
  ]);
}

async function withMigratedDatabase(
  operation: (database: Database, path: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "veylta-document-size-"));
  const path = join(root, "test.sqlite");
  const database = createDatabase(path);
  try {
    await migrateUp(database);
    await operation(database, path);
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
}

/** The upper bound of `CHECK (<column> BETWEEN <low> AND <high>)` as the live schema states it. */
async function schemaCeiling(database: Database, table: string, column: string): Promise<number> {
  const definition = (
    await database.query<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = $1",
      [table],
    )
  ).rows[0]?.sql;
  assert.ok(definition !== undefined, `${table} is missing`);
  const bound = new RegExp(`${column} BETWEEN \\d+ AND (\\d+)`).exec(definition);
  assert.ok(bound !== null, `${table}.${column} carries no BETWEEN bound`);
  return Number(bound[1]);
}

test("the schema accepts exactly the documents the contract accepts", async () => {
  await withMigratedDatabase(async (database) => {
    for (const { table, column } of BYTE_SIZE_COLUMNS) {
      assert.equal(
        await schemaCeiling(database, table, column),
        MAX_SYNTHETIC_DOCUMENT_BYTES,
        `${table}.${column} must admit every document the upload route accepts`,
      );
    }
  });
});

test("a document larger than the previous ceiling is stored and read back whole", async () => {
  await withDocumentContext(async ({ app, database }) => {
    const owner = await register(app, "Large source");
    const pdf = syntheticPdf(PREVIOUS_DOCUMENT_CEILING + 1);

    const uploaded = await uploadDocument(app, owner, pdf, "large-source-001");
    assert.equal(uploaded.statusCode, 202, uploaded.rawPayload.toString());
    const document = uploaded.json().document;
    assert.equal(document.byteSize, pdf.byteLength);
    assert.equal(document.sha256, createHash("sha256").update(pdf).digest("hex"));

    // Both tables that record how large the source was must admit it, not just the blob.
    const stored = await database.query<{ byte_size: number }>(
      `SELECT byte_size FROM document_blobs
       UNION ALL
       SELECT request_byte_size AS byte_size FROM document_upload_requests`,
    );
    assert.deepEqual(stored.rows, [{ byte_size: pdf.byteLength }, { byte_size: pdf.byteLength }]);

    // A controlled read must still hand back the whole object, not a bounded prefix.
    const content = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${document.id}/content`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(content.statusCode, 200);
    assert.equal(content.headers["content-length"], String(pdf.byteLength));
    assert.deepEqual(content.rawPayload, pdf);
  });
});

test("re-uploading a large source answers from the one already kept", async () => {
  await withDocumentContext(async ({ app }) => {
    const owner = await register(app, "Large replay");
    const pdf = syntheticPdf(PREVIOUS_DOCUMENT_CEILING + 1);

    const first = await uploadDocument(app, owner, pdf, "large-replay-001");
    assert.equal(first.statusCode, 202, first.rawPayload.toString());
    const replay = await uploadDocument(app, owner, pdf, "large-replay-001");
    assert.equal(replay.statusCode, 200, replay.rawPayload.toString());
    assert.equal(replay.json().disposition, "already_exists");
    assert.equal(replay.json().document.id, first.json().document.id);
  });
});

test("0040 moves the bound on a record that already holds documents", async () => {
  await withDocumentContext(async ({ app, database }) => {
    const owner = await register(app, "Migration record");
    // A real upload leaves the children the rebuild must not disturb: a document version, the
    // content-type overlays and the recorded upload request.
    const kept = await uploadDocument(app, owner, syntheticPdf(64 * 1024), "migration-small-001");
    assert.equal(kept.statusCode, 202, kept.rawPayload.toString());
    const documentId = kept.json().document.id;

    await rollbackTo(database, "0040_document_size_ceiling");
    assert.equal(
      await schemaCeiling(database, "document_blobs", "byte_size"),
      PREVIOUS_DOCUMENT_CEILING,
    );
    await reapplyFrom(database, "0040_document_size_ceiling");
    for (const { table, column } of BYTE_SIZE_COLUMNS) {
      assert.equal(await schemaCeiling(database, table, column), MAX_SYNTHETIC_DOCUMENT_BYTES);
    }
    assert.deepEqual((await database.query("PRAGMA foreign_key_check")).rows, []);
    assert.deepEqual((await database.query("PRAGMA integrity_check")).rows, [
      { integrity_check: "ok" },
    ]);
    const survivor = await app.inject({
      method: "GET",
      url: `/v1/families/${owner.body.family.id}/profiles/${owner.body.profile.id}/documents/${documentId}`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(survivor.statusCode, 200);
    assert.equal(survivor.json().document.byteSize, 64 * 1024);

    // A source the old bound cannot express is never dropped to make a rollback succeed.
    const large = await uploadDocument(
      app,
      owner,
      syntheticPdf(PREVIOUS_DOCUMENT_CEILING + 1),
      "migration-large-001",
    );
    assert.equal(large.statusCode, 202, large.rawPayload.toString());
    await assert.rejects(rollbackTo(database, "0040_document_size_ceiling"), /CHECK constraint/);
    assert.equal(
      await schemaCeiling(database, "document_blobs", "byte_size"),
      MAX_SYNTHETIC_DOCUMENT_BYTES,
    );
  });
});

test("0040 reaches a connection that opened before it ran", async () => {
  await withMigratedDatabase(async (database, path) => {
    await rollbackTo(database, "0040_document_size_ceiling");
    const running = createDatabase(path);
    try {
      const now = new Date().toISOString();
      const userId = randomUUID();
      const familyId = randomUUID();
      await running.transaction(async (client) => {
        await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
          userId,
          "Running owner",
          now,
        ]);
        await client.query(
          "INSERT INTO families (id, display_name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)",
          [familyId, "Running family", userId, now],
        );
        await client.query(
          `INSERT INTO family_memberships (id, family_id, user_id, role, status, created_at)
           VALUES ($1, $2, $3, 'owner', 'active', $4)`,
          [randomUUID(), familyId, userId, now],
        );
      });

      await reapplyFrom(database, "0040_document_size_ceiling");

      // The api and the worker hold their own connections; a widened bound that never moved the
      // schema cookie would go on refusing large sources there until the process restarted.
      const blobId = randomUUID();
      await running.transaction((client) =>
        client.query(
          `INSERT INTO document_blobs
             (id, family_id, storage_contract_version, storage_key, content_type, byte_size, sha256, created_at)
           VALUES ($1, $2, 'object-storage/v1', $3, 'application/pdf', $4, $5, $6)`,
          [
            blobId,
            familyId,
            `families/${familyId}/documents/${blobId}`,
            PREVIOUS_DOCUMENT_CEILING + 1,
            "a".repeat(64),
            now,
          ],
        ),
      );
      assert.equal(
        (await running.query<{ byte_size: number }>("SELECT byte_size FROM document_blobs")).rows[0]
          ?.byte_size,
        PREVIOUS_DOCUMENT_CEILING + 1,
      );
    } finally {
      await running.close();
    }
  });
});
