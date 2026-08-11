import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import { createPool } from "../src/database/pool.js";

test("foundation migration applies, rolls back, and reapplies", async () => {
  const pool = createPool(loadConfig().databaseUrl);
  try {
    await migrateUp(pool);
    const applied = await pool.query<{ value: string }>(
      "SELECT value FROM service_metadata WHERE key = 'foundation_version'",
    );
    assert.equal(applied.rows[0]?.value, "1");

    assert.equal(await migrateDown(pool), "0001_foundation");
    const rolledBack = await pool.query<{ table_name: string | null }>(
      "SELECT to_regclass('public.service_metadata')::text AS table_name",
    );
    assert.equal(rolledBack.rows[0]?.table_name, null);

    assert.deepEqual(await migrateUp(pool), ["0001_foundation"]);
  } finally {
    await pool.end();
  }
});
