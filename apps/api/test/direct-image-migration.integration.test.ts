import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";

test("direct-image MIME provenance blocks a lossy schema rollback", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-direct-image-rollback-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
    await database.transaction(async (client) => {
      await client.query("INSERT INTO users (id, display_name) VALUES ($1, $2)", [
        "10000000-0000-4000-8000-000000000001",
        "Owner",
      ]);
      await client.query(
        "INSERT INTO families (id, display_name, created_by_user_id) VALUES ($1, $2, $3)",
        ["10000000-0000-4000-8000-000000000002", "Family", "10000000-0000-4000-8000-000000000001"],
      );
      await client.query(
        "INSERT INTO family_memberships (id, family_id, user_id, role, status) VALUES ($1, $2, $3, 'owner', 'active')",
        [
          "10000000-0000-4000-8000-000000000003",
          "10000000-0000-4000-8000-000000000002",
          "10000000-0000-4000-8000-000000000001",
        ],
      );
      await client.query(
        "INSERT INTO document_blobs (id, family_id, storage_contract_version, storage_key, content_type, byte_size, sha256) VALUES ($1, $2, 'object-storage/v1', $3, 'application/pdf', 8, $4)",
        [
          "10000000-0000-4000-8000-000000000004",
          "10000000-0000-4000-8000-000000000002",
          "family_10000000-0000-4000-8000-000000000002/sha256_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ],
      );
      await client.query(
        "INSERT INTO document_blob_content_types (blob_id, family_id, content_type) VALUES ($1, $2, 'image/png')",
        ["10000000-0000-4000-8000-000000000004", "10000000-0000-4000-8000-000000000002"],
      );
    });

    assert.equal(await migrateDown(database), "0026_document_reasoning_effort");
    assert.equal(await migrateDown(database), "0025_run_diagnostics");
    assert.equal(await migrateDown(database), "0024_document_agent_threads");
    assert.equal(await migrateDown(database), "0023_document_lifecycle");
    assert.equal(await migrateDown(database), "0022_document_intelligence_v2");
    assert.equal(await migrateDown(database), "0021_codex_preferences");
    assert.equal(await migrateDown(database), "0020_processing_activity");
    assert.equal(await migrateDown(database), "0019_document_agent");
    assert.equal(await migrateDown(database), "0018_document_reanalysis");
    assert.equal(await migrateDown(database), "0017_analyte_catalog");
    assert.equal(await migrateDown(database), "0016_document_intelligence");
    assert.equal(await migrateDown(database), "0015_codex_care_plan_proposals");
    assert.equal(await migrateDown(database), "0014_home_care_plan");
    assert.equal(await migrateDown(database), "0013_home_settings");
    assert.equal(await migrateDown(database), "0012_app_accounts");
    assert.equal(await migrateDown(database), "0011_health_summaries");
    await assert.rejects(() => migrateDown(database), /CHECK constraint failed/);
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
