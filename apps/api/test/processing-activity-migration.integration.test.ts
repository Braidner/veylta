import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import { createDatabase } from "../src/database/pool.js";
import { createProcessingJobService } from "../src/processing/processing-job-service.js";

test("processing activity is append-only and prevents a lossy rollback", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-processing-activity-"));
  const database = createDatabase(join(root, "test.sqlite"));
  const userId = randomUUID();
  const familyId = randomUUID();
  const profileId = randomUUID();
  const blobId = randomUUID();
  const documentId = randomUUID();
  const documentVersionId = randomUUID();
  const now = new Date("2026-08-14T16:00:00.000Z");
  const sha256 = createHash("sha256").update("synthetic activity fixture").digest("hex");

  try {
    await migrateUp(database);
    await database.transaction(async (client) => {
      await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
        userId,
        "Synthetic activity owner",
        now,
      ]);
      await client.query(
        "INSERT INTO families (id, display_name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)",
        [familyId, "Synthetic activity family", userId, now],
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
        [profileId, familyId, "Synthetic activity profile", userId, now],
      );
      await client.query(
        `INSERT INTO document_blobs
           (id, family_id, storage_contract_version, storage_key, content_type,
            byte_size, sha256, created_at)
         VALUES ($1, $2, 'object-storage/v1', $3, 'application/pdf', 8, $4, $5)`,
        [blobId, familyId, `family_${familyId}/sha256_${sha256}`, sha256, now],
      );
      await client.query(
        `INSERT INTO documents
           (id, family_id, patient_profile_id, status, original_filename,
            uploaded_by_user_id, uploaded_at)
         VALUES ($1, $2, $3, 'uploaded', 'synthetic-activity.pdf', $4, $5)`,
        [documentId, familyId, profileId, userId, now],
      );
      await client.query(
        `INSERT INTO document_versions
           (id, family_id, document_id, blob_id, version_number, created_at)
         VALUES ($1, $2, $3, $4, 1, $5)`,
        [documentVersionId, familyId, documentId, blobId, now],
      );
    });

    const job = await createProcessingJobService(database).enqueueDocumentExtraction({
      familyId,
      documentVersionId,
      now,
    });
    const event = await database.query<{ attempt: number; code: string }>(
      "SELECT code, attempt FROM processing_job_events WHERE processing_job_id = $1",
      [job.id],
    );
    assert.deepEqual(event.rows, [{ code: "queued", attempt: 0 }]);
    await assert.rejects(
      () =>
        database.query(
          "UPDATE processing_job_events SET code = 'failed' WHERE processing_job_id = $1",
          [job.id],
        ),
      /immutable/,
    );
    await assert.rejects(
      () =>
        database.query("DELETE FROM processing_job_events WHERE processing_job_id = $1", [job.id]),
      /immutable/,
    );
    assert.equal(await migrateDown(database), "0025_run_diagnostics");
    assert.equal(await migrateDown(database), "0024_document_agent_threads");
    assert.equal(await migrateDown(database), "0023_document_lifecycle");
    assert.equal(await migrateDown(database), "0022_document_intelligence_v2");
    assert.equal(await migrateDown(database), "0021_codex_preferences");
    await assert.rejects(() => migrateDown(database), /CHECK constraint failed/);
    assert.deepEqual(await migrateUp(database), [
      "0021_codex_preferences",
      "0022_document_intelligence_v2",
      "0023_document_lifecycle",
      "0024_document_agent_threads",
      "0025_run_diagnostics",
    ]);
    await assert.doesNotReject(() => database.check());
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
});
