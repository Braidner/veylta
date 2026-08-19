import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";
import { backfillProfileHandles, createPatientProfile } from "../src/family/patient-profiles.js";
import { reapplyFrom, rollbackTo } from "./migration-chain.js";

async function seedFamily(database: Database, suffix: string) {
  const userId = randomUUID();
  const familyId = randomUUID();
  const now = new Date().toISOString();
  await database.transaction(async (client) => {
    await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
      userId,
      `Владелец ${suffix}`,
      now,
    ]);
    await client.query(
      `INSERT INTO app_accounts (user_id, username, password_hash, role, created_at, updated_at)
       VALUES ($1, $2, $3, 'user', $4, $4)`,
      [userId, `owner-${suffix}`, `scrypt-v1$${"x".repeat(90)}`, now],
    );
    await client.query(
      `INSERT INTO families (id, display_name, created_by_user_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [familyId, `Семья ${suffix}`, userId, now],
    );
    await client.query(
      `INSERT INTO family_memberships (id, family_id, user_id, role, status, created_at)
       VALUES ($1, $2, $3, 'owner', 'active', $4)`,
      [randomUUID(), familyId, userId, now],
    );
  });
  return { userId, familyId, now };
}

test("0038: existing profiles get provisional handles, the backfill applies the rule, the helper keeps uniqueness", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-handles-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
    await rollbackTo(database, "0038_profile_handles");
    const { userId, familyId, now } = await seedFamily(database, "a");
    const linked = randomUUID();
    const child = randomUUID();
    await database.transaction(async (client) => {
      await client.query(
        `INSERT INTO patient_profiles
           (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
         VALUES ($1, $2, 'Владелец A', 'adult', $3, $3, $4)`,
        [linked, familyId, userId, now],
      );
      await client.query(
        `INSERT INTO patient_profiles
           (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
         VALUES ($1, $2, 'Анна Иванова', 'dependent', NULL, $3, $4)`,
        [child, familyId, userId, now],
      );
    });
    await reapplyFrom(database, "0038_profile_handles");
    const provisional = await database.query<{ id: string; handle: string; handle_set_by: string }>(
      "SELECT id, handle, handle_set_by FROM patient_profiles ORDER BY created_at, rowid",
    );
    assert.equal(provisional.rows.length, 2);
    for (const row of provisional.rows) {
      assert.match(row.handle, /^p-[0-9a-f]{12}$/);
      assert.equal(row.handle_set_by, "auto");
    }

    const rewritten = await backfillProfileHandles(database);
    assert.equal(rewritten, 2);
    const after = await database.query<{ id: string; handle: string }>(
      "SELECT id, handle FROM patient_profiles WHERE id IN ($1, $2) ORDER BY created_at, rowid",
      [linked, child],
    );
    assert.deepEqual(
      after.rows.map((row) => row.handle),
      ["owner-a", "anna"],
      "the linked profile takes the username, the dependent the name",
    );
    assert.equal(await backfillProfileHandles(database), 0, "idempotent");

    // The helper: a second Анна becomes anna-2.
    const annaTwo = randomUUID();
    const handle = await database.transaction((client) =>
      createPatientProfile(client, {
        id: annaTwo,
        familyId,
        displayName: "Анна Петрова",
        kind: "dependent",
        linkedUserId: null,
        createdByUserId: userId,
        createdAt: now,
        username: null,
      }),
    );
    assert.equal(handle, "anna-2");
    // A name of its own can start with `p-`; only a real provisional handle is rewritten.
    const looksProvisional = await database.transaction((client) =>
      createPatientProfile(client, {
        id: randomUUID(),
        familyId,
        displayName: "П-Абв Петров",
        kind: "dependent",
        linkedUserId: null,
        createdByUserId: userId,
        createdAt: now,
        username: null,
      }),
    );
    assert.equal(looksProvisional, "p-abv");
    assert.equal(await backfillProfileHandles(database), 0, "a name that reads as `p-…` is kept");
    await assert.rejects(
      database.transaction((client) =>
        client.query("UPDATE patient_profiles SET handle = 'anna' WHERE id = $1", [annaTwo]),
      ),
      /UNIQUE constraint failed/,
      "one handle per server",
    );
    await assert.rejects(
      database.transaction((client) =>
        client.query("UPDATE patient_profiles SET handle = 'ANNA' WHERE id = $1", [child]),
      ),
      /CHECK constraint failed/,
      "a handle is lower case",
    );

    // Rollback drops the columns; re-apply brings provisional handles back.
    await rollbackTo(database, "0038_profile_handles");
    const columns = await database.query<{ name: string }>("PRAGMA table_info(patient_profiles)");
    assert.equal(
      columns.rows.some((column) => column.name === "handle"),
      false,
    );
    await reapplyFrom(database, "0038_profile_handles");
    const again = await database.query<{ handle: string }>("SELECT handle FROM patient_profiles");
    assert.equal(again.rows.length, 4);
    assert.ok(again.rows.every((row) => /^p-[0-9a-f]{12}$/.test(row.handle)));
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
