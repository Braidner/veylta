import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import { createPool } from "../src/database/pool.js";

test("all migrations apply, roll back in order, and reapply", async () => {
  const pool = createPool(loadConfig().databaseUrl);
  try {
    await migrateUp(pool);
    const applied = await pool.query<{ value: string }>(
      "SELECT value FROM service_metadata WHERE key = 'foundation_version'",
    );
    assert.equal(applied.rows[0]?.value, "1");
    const usersApplied = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.users')::text AS table_name",
    );
    assert.equal(usersApplied.rows[0]?.table_name, "users");

    assert.equal(await migrateDown(pool), "0002_family_profiles");
    const familyTablesRolledBack = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.users')::text AS table_name",
    );
    assert.equal(familyTablesRolledBack.rows[0]?.table_name, null);

    assert.equal(await migrateDown(pool), "0001_foundation");
    const rolledBack = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.service_metadata')::text AS table_name",
    );
    assert.equal(rolledBack.rows[0]?.table_name, null);

    assert.deepEqual(await migrateUp(pool), ["0001_foundation", "0002_family_profiles"]);
  } finally {
    await pool.end();
  }
});
