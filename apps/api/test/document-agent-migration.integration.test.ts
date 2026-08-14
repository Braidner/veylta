import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";

test("document agent persistence is append-only and included in readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-agent-migration-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
    await database.check();
    const tables = await database.query<{ name: string }>(
      `SELECT name
         FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'document_agent_conversations',
            'document_agent_messages',
            'document_agent_message_requests'
          )
        ORDER BY name`,
    );
    assert.deepEqual(
      tables.rows.map((row) => row.name),
      [
        "document_agent_conversations",
        "document_agent_message_requests",
        "document_agent_messages",
      ],
    );

    const triggers = await database.query<{ name: string }>(
      `SELECT name
         FROM sqlite_master
        WHERE type = 'trigger' AND name LIKE 'document_agent_%_forbidden'
        ORDER BY name`,
    );
    assert.deepEqual(
      triggers.rows.map((row) => row.name),
      [
        "document_agent_message_requests_delete_forbidden",
        "document_agent_message_requests_update_forbidden",
        "document_agent_messages_delete_forbidden",
        "document_agent_messages_update_forbidden",
      ],
    );
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
