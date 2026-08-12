import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";

async function tableExists(database: Database, name: string): Promise<boolean> {
  const result = await database.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = $1",
    [name],
  );
  return result.rows[0]?.name === name;
}

test("all migrations apply, roll back in order, and reapply", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "family-health-migrations-"));
  const database = createDatabase(join(testRoot, "test.sqlite"));
  try {
    await migrateUp(database);
    const applied = await database.query<{ value: string }>(
      "SELECT value FROM service_metadata WHERE key = 'foundation_version'",
    );
    assert.equal(applied.rows[0]?.value, "1");
    assert.equal(await tableExists(database, "users"), true);
    assert.equal(await tableExists(database, "documents"), true);
    await assert.doesNotReject(() => database.check());

    assert.equal(await migrateDown(database), "0003_documents");
    assert.equal(await tableExists(database, "documents"), false);
    await assert.rejects(
      () => database.check(),
      /Current database schema migration is not available/,
    );

    const now = new Date().toISOString();
    const userId = randomUUID();
    const familyId = randomUUID();
    await database.transaction(async (client) => {
      await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
        userId,
        "Synthetic rollback owner",
        now,
      ]);
      await client.query(
        "INSERT INTO families (id, display_name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)",
        [familyId, "Synthetic rollback family", userId, now],
      );
      await client.query(
        `INSERT INTO family_memberships
           (id, family_id, user_id, role, status, created_at)
         VALUES ($1, $2, $3, 'owner', 'active', $4)`,
        [randomUUID(), familyId, userId, now],
      );
      await client.query(
        `INSERT INTO patient_profiles
           (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
         VALUES ($1, $2, $3, 'adult', $4, $4, $5)`,
        [randomUUID(), familyId, "Synthetic rollback profile", userId, now],
      );
    });

    assert.equal(await migrateDown(database), "0002_family_profiles");
    assert.equal(await tableExists(database, "users"), false);

    assert.equal(await migrateDown(database), "0001_foundation");
    assert.equal(await tableExists(database, "service_metadata"), false);

    assert.deepEqual(await migrateUp(database), [
      "0001_foundation",
      "0002_family_profiles",
      "0003_documents",
    ]);
    await assert.doesNotReject(() => database.check());
    const foreignKeyViolations = await database.query<Record<string, unknown>>(
      "PRAGMA foreign_key_check",
    );
    assert.deepEqual(foreignKeyViolations.rows, []);
  } finally {
    await database.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});
