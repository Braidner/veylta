import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateUp } from "../src/database/migrations.js";
import { createDatabase, type Database } from "../src/database/pool.js";
import { reapplyFrom, rollbackTo } from "./migration-chain.js";

async function seedProfile(database: Database) {
  const now = new Date().toISOString();
  const userId = randomUUID();
  const familyId = randomUUID();
  const profileId = randomUUID();
  await database.transaction(async (client) => {
    await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
      userId,
      "Migration owner",
      now,
    ]);
    await client.query(
      "INSERT INTO families (id, display_name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)",
      [familyId, "Migration family", userId, now],
    );
    await client.query(
      `INSERT INTO family_memberships (id, family_id, user_id, role, status, created_at)
       VALUES ($1, $2, $3, 'owner', 'active', $4)`,
      [randomUUID(), familyId, userId, now],
    );
    await client.query(
      `INSERT INTO patient_profiles
         (id, family_id, display_name, kind, linked_user_id, created_by_user_id, created_at)
       VALUES ($1, $2, 'Migration profile', 'adult', $3, $3, $4)`,
      [profileId, familyId, userId, now],
    );
  });
  return { userId, familyId, profileId, now };
}

async function insertConversation(
  database: Database,
  seed: Awaited<ReturnType<typeof seedProfile>>,
  assistantId: string,
  purpose: string | null = null,
): Promise<string> {
  const id = randomUUID();
  await database.transaction((client) =>
    client.query(
      `INSERT INTO assistant_conversations
         (id, family_id, patient_profile_id, assistant_id, created_by_user_id, title,
          created_at, updated_at, purpose)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
      [
        id,
        seed.familyId,
        seed.profileId,
        assistantId,
        seed.userId,
        `Диалог ${assistantId}`,
        seed.now,
        purpose,
      ],
    ),
  );
  return id;
}

test("0035 widens the assistant id and carries every conversation, message and request across", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-assistant-ids-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
    await rollbackTo(database, "0035_assistant_ids");
    const seed = await seedProfile(database);
    const physician = await insertConversation(database, seed, "physician", "dossier:therapist");
    const messageId = randomUUID();
    await database.transaction(async (client) => {
      await client.query(
        `INSERT INTO assistant_messages
           (id, family_id, conversation_id, sequence, role, actor_user_id, text, created_at)
         VALUES ($1, $2, $3, 1, 'user', $4, 'Что значат мои анализы?', $5)`,
        [messageId, seed.familyId, physician, seed.userId, seed.now],
      );
      await client.query(
        `INSERT INTO assistant_conversation_requests
           (id, family_id, actor_user_id, conversation_id, idempotency_key_hash, request_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          seed.familyId,
          seed.userId,
          physician,
          "a".repeat(64),
          "b".repeat(64),
          seed.now,
        ],
      );
    });
    await assert.rejects(insertConversation(database, seed, "nutritionist"), /CHECK constraint/);

    await reapplyFrom(database, "0035_assistant_ids");
    const kept = await database.query<{ id: string; title: string; purpose: string | null }>(
      "SELECT id, title, purpose FROM assistant_conversations",
    );
    assert.deepEqual(kept.rows, [
      { id: physician, title: "Диалог physician", purpose: "dossier:therapist" },
    ]);
    const joined = await database.query<{ id: string }>(
      `SELECT m.id FROM assistant_messages m
         JOIN assistant_conversations c ON c.family_id = m.family_id AND c.id = m.conversation_id`,
    );
    assert.deepEqual(joined.rows, [{ id: messageId }]);
    const violations = await database.query<{ table: string }>("PRAGMA foreign_key_check");
    assert.deepEqual(violations.rows, []);

    const nutritionist = await insertConversation(database, seed, "nutritionist");
    await insertConversation(database, seed, "trainer");
    await assert.rejects(insertConversation(database, seed, "dietitian"), /CHECK constraint/);
    // The purpose index still keeps one conversation per profile, assistant and purpose.
    await assert.rejects(
      insertConversation(database, seed, "physician", "dossier:therapist"),
      /UNIQUE constraint/,
    );
    await database.transaction((client) =>
      client.query(
        `INSERT INTO assistant_messages
           (id, family_id, conversation_id, sequence, role, actor_user_id, text, created_at)
         VALUES ($1, $2, $3, 1, 'user', $4, 'Что мне есть?', $5)`,
        [randomUUID(), seed.familyId, nutritionist, seed.userId, seed.now],
      ),
    );

    // Rolling back loses the other assistants' dialogues and nothing of the physician's.
    await rollbackTo(database, "0035_assistant_ids");
    const after = await database.query<{ assistant_id: string }>(
      "SELECT assistant_id FROM assistant_conversations",
    );
    assert.deepEqual(after.rows, [{ assistant_id: "physician" }]);
    const messages = await database.query<{ count: number }>(
      "SELECT count(*) AS count FROM assistant_messages",
    );
    assert.equal(messages.rows[0]?.count, 1);
    assert.deepEqual((await database.query("PRAGMA foreign_key_check")).rows, []);
    await reapplyFrom(database, "0035_assistant_ids");
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
