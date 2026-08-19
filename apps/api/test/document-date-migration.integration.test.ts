import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";
import { reapplyFrom, rollbackTo } from "./migration-chain.js";

test("0039 adds a checked document_date_override, rolls back and re-applies", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-document-date-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
    const columns = await database.query<{ name: string }>(`PRAGMA table_info(documents)`);
    assert.ok(columns.rows.some((column) => column.name === "document_date_override"));
    // Foreign keys are on (pool.ts `PRAGMA foreign_keys = ON`): a user, a family, its membership
    // (both patient_profiles.created_by_user_id and documents.uploaded_by_user_id reference it),
    // a profile, a document.
    const userId = randomUUID();
    const familyId = randomUUID();
    const profileId = randomUUID();
    const documentId = randomUUID();
    const now = "2026-08-19T10:00:00.000Z";
    await database.transaction(async (client) => {
      await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
        userId,
        "Владелец",
        now,
      ]);
      await client.query(
        `INSERT INTO families (id, display_name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)`,
        [familyId, "Семья", userId, now],
      );
      await client.query(
        `INSERT INTO family_memberships (id, family_id, user_id, role, status, created_at)
         VALUES ($1, $2, $3, 'owner', 'active', $4)`,
        [randomUUID(), familyId, userId, now],
      );
      await client.query(
        `INSERT INTO patient_profiles (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
         VALUES ($1, $2, 'Анна', 'adult', $3, $3, $4)`,
        [profileId, familyId, userId, now],
      );
      await client.query(
        `INSERT INTO documents (id, family_id, patient_profile_id, status, original_filename, uploaded_by_user_id, uploaded_at)
         VALUES ($1, $2, $3, 'uploaded', 'report.pdf', $4, $5)`,
        [documentId, familyId, profileId, userId, now],
      );
    });
    await database.query(
      `UPDATE documents SET document_date_override = '2026-05-14' WHERE id = $1`,
      [documentId],
    );
    await assert.rejects(
      database.query(`UPDATE documents SET document_date_override = '2026-02-30' WHERE id = $1`, [
        documentId,
      ]),
      /CHECK constraint failed/,
    );
    await assert.rejects(
      database.query(`UPDATE documents SET document_date_override = '14.05.2026' WHERE id = $1`, [
        documentId,
      ]),
      /CHECK constraint failed/,
    );
    await rollbackTo(database, "0039_document_date_override");
    const after = await database.query<{ name: string }>(`PRAGMA table_info(documents)`);
    assert.ok(!after.rows.some((column) => column.name === "document_date_override"));
    await reapplyFrom(database, "0039_document_date_override");
    const again = await database.query<{ name: string }>(`PRAGMA table_info(documents)`);
    assert.ok(again.rows.some((column) => column.name === "document_date_override"));
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
