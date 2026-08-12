import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateDown, migrateUp } from "../src/database/migrations.js";
import {
  createDatabase,
  type Database,
  type DatabaseClient,
  isSqliteConstraintError,
} from "../src/database/pool.js";

interface DocumentFixture {
  documentId: string;
  familyId: string;
  documentVersionId: string;
  profileId: string;
  userId: string;
}

interface ProcessingGraph {
  factId: string;
  jobId: string;
  pageId: string;
  runId: string;
}

interface ReviewGraph {
  decisionId: string;
  observationId: string;
  rangeId: string;
  requestId: string;
}

async function tableExists(database: Database, name: string): Promise<boolean> {
  const result = await database.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = $1",
    [name],
  );
  return result.rows[0]?.name === name;
}

async function createDocumentFixture(database: Database, label: string): Promise<DocumentFixture> {
  const now = new Date().toISOString();
  const userId = randomUUID();
  const familyId = randomUUID();
  const profileId = randomUUID();
  const blobId = randomUUID();
  const documentId = randomUUID();
  const documentVersionId = randomUUID();
  const checksum = Buffer.from(label).toString("hex").padEnd(64, "0").slice(0, 64);

  await database.transaction(async (client) => {
    await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
      userId,
      `${label} owner`,
      now,
    ]);
    await client.query(
      "INSERT INTO families (id, display_name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)",
      [familyId, `${label} family`, userId, now],
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
      [profileId, familyId, `${label} profile`, userId, now],
    );
    await client.query(
      `INSERT INTO document_blobs
         (id, family_id, storage_contract_version, storage_key, content_type,
          byte_size, sha256, created_at)
       VALUES ($1, $2, 'object-storage/v1', $3, 'application/pdf', 8, $4, $5)`,
      [blobId, familyId, `${familyId}/${checksum}.pdf`, checksum, now],
    );
    await client.query(
      `INSERT INTO documents
         (id, family_id, patient_profile_id, status, original_filename,
          uploaded_by_user_id, uploaded_at)
       VALUES ($1, $2, $3, 'uploaded', $4, $5, $6)`,
      [documentId, familyId, profileId, `${label}.pdf`, userId, now],
    );
    await client.query(
      `INSERT INTO document_versions
         (id, family_id, document_id, blob_id, version_number, created_at)
       VALUES ($1, $2, $3, $4, 1, $5)`,
      [documentVersionId, familyId, documentId, blobId, now],
    );
  });

  return { documentId, familyId, documentVersionId, profileId, userId };
}

async function createAnotherDocumentVersion(
  database: Database,
  fixture: DocumentFixture,
  label: string,
): Promise<string> {
  const now = new Date().toISOString();
  const blobId = randomUUID();
  const documentId = randomUUID();
  const documentVersionId = randomUUID();
  const checksum = Buffer.from(`another-${label}`).toString("hex").padEnd(64, "0").slice(0, 64);

  await database.transaction(async (client) => {
    await client.query(
      `INSERT INTO document_blobs
         (id, family_id, storage_contract_version, storage_key, content_type,
          byte_size, sha256, created_at)
       VALUES ($1, $2, 'object-storage/v1', $3, 'application/pdf', 8, $4, $5)`,
      [blobId, fixture.familyId, `${fixture.familyId}/${checksum}.pdf`, checksum, now],
    );
    await client.query(
      `INSERT INTO documents
         (id, family_id, patient_profile_id, status, original_filename,
          uploaded_by_user_id, uploaded_at)
       VALUES ($1, $2, $3, 'uploaded', $4, $5, $6)`,
      [documentId, fixture.familyId, fixture.profileId, `${label}.pdf`, fixture.userId, now],
    );
    await client.query(
      `INSERT INTO document_versions
         (id, family_id, document_id, blob_id, version_number, created_at)
       VALUES ($1, $2, $3, $4, 1, $5)`,
      [documentVersionId, fixture.familyId, documentId, blobId, now],
    );
  });

  return documentVersionId;
}

async function insertProcessingGraph(
  database: Database,
  fixture: DocumentFixture,
  suffix: string,
  pageNumber = 1,
): Promise<ProcessingGraph> {
  const now = new Date().toISOString();
  const jobId = randomUUID();
  const runId = randomUUID();
  const pageId = randomUUID();
  const factId = randomUUID();

  await database.transaction(async (client) => {
    await client.query(
      `INSERT INTO processing_jobs
         (id, family_id, document_version_id, kind, dedupe_key, payload_version,
          state, attempt_count, max_attempts, available_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'document_extraction', $4,
               'document-extraction-job/v1', 'pending', 0, 3, $5, $5, $5)`,
      [jobId, fixture.familyId, fixture.documentVersionId, `extract:${suffix}`, now],
    );
    await client.query(
      `INSERT INTO extraction_runs
         (id, family_id, document_version_id, job_id, extractor_kind,
          extractor_version, output_schema_version, status, created_at)
       VALUES ($1, $2, $3, $4, 'deterministic_pdf_text', '1',
               'lab-extraction/v1', 'queued', $5)`,
      [runId, fixture.familyId, fixture.documentVersionId, jobId, now],
    );
    await client.query(
      `INSERT INTO document_pages
         (id, family_id, document_version_id, page_number, extracted_text,
          extraction_method, extraction_version, text_sha256, created_at)
       VALUES ($1, $2, $3, $4, 'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit',
               'pdf_text_layer', '1', $5, $6)`,
      [pageId, fixture.familyId, fixture.documentVersionId, pageNumber, "a".repeat(64), now],
    );
    await client.query(
      `INSERT INTO extracted_facts
         (id, family_id, document_version_id, extraction_run_id, document_page_id, fact_key,
          source_fragment, source_name, source_value, source_unit,
          proposed_canonical_code, proposed_normalized_value,
          proposed_normalized_unit, proposed_reference_range,
          proposed_specimen, proposed_sampled_at, proposed_resulted_at,
          proposed_laboratory, confidence, validation_issues, review_status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'synthetic-analyte-a',
               'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit', 'SYNTHETIC_ANALYTE_A',
               '7.0', 'synthetic-unit', 'synthetic-analyte-a', NULL, NULL,
               '{"sourceText":"synthetic reference","sourceLow":null,"sourceHigh":null,"sourceUnit":"synthetic-unit","laboratoryOutOfRange":null}',
               'synthetic specimen', '2026-08-10T08:00:00.000Z',
               '2026-08-10T10:00:00.000Z', 'Synthetic Laboratory',
               0.6, '["AMBIGUOUS_UNIT"]',
               'needs_review', $6)`,
      [factId, fixture.familyId, fixture.documentVersionId, runId, pageId, now],
    );
  });

  return { factId, jobId, pageId, runId };
}

async function insertConfirmedReviewGraphRows(
  client: DatabaseClient,
  fixture: DocumentFixture,
  processing: ProcessingGraph,
  suffix: string,
): Promise<ReviewGraph> {
  const now = new Date().toISOString();
  const decisionId = randomUUID();
  const observationId = randomUUID();
  const rangeId = randomUUID();
  const requestId = randomUUID();
  const idempotencyKeyHash = Buffer.from(`review:${suffix}`)
    .toString("hex")
    .padEnd(64, "0")
    .slice(0, 64);
  const requestHash = Buffer.from(`request:${suffix}`).toString("hex").padEnd(64, "0").slice(0, 64);

  await client.query(
    `INSERT INTO observations
         (id, family_id, patient_profile_id, document_id, document_version_id,
          document_page_id, source_extracted_fact_id, source_fact_version,
          review_decision_id, status, canonical_code, source_name, source_value,
          source_unit, normalized_value, normalized_unit, conversion_version,
          sampled_at, resulted_at, uploaded_at, specimen_type, laboratory,
          source_fragment, extraction_confidence, confirmed_by_user_id,
          confirmed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, 'confirmed',
               'synthetic-analyte-a', 'SYNTHETIC_ANALYTE_A', '7.0',
               'synthetic-unit', NULL, NULL, NULL,
               '2026-08-10T08:00:00.000Z', '2026-08-10T10:00:00.000Z', $9,
               'synthetic specimen', 'Synthetic Laboratory',
               'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit', 0.6, $10, $9, $9)`,
    [
      observationId,
      fixture.familyId,
      fixture.profileId,
      fixture.documentId,
      fixture.documentVersionId,
      processing.pageId,
      processing.factId,
      decisionId,
      now,
      fixture.userId,
    ],
  );
  await client.query(
    `INSERT INTO review_decisions
         (id, family_id, extracted_fact_id, source_fact_version, outcome,
          corrected_source_name, corrected_source_value, corrected_source_unit,
          observation_id, decided_by_user_id, decided_at, created_at)
       VALUES ($1, $2, $3, 1, 'confirm', NULL, NULL, NULL, $4, $5, $6, $6)`,
    [decisionId, fixture.familyId, processing.factId, observationId, fixture.userId, now],
  );
  await client.query(
    `INSERT INTO review_requests
         (id, family_id, actor_user_id, extracted_fact_id, review_decision_id,
          idempotency_key_hash, request_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      requestId,
      fixture.familyId,
      fixture.userId,
      processing.factId,
      decisionId,
      idempotencyKeyHash,
      requestHash,
      now,
    ],
  );
  await client.query(
    `INSERT INTO observation_reference_ranges
         (id, family_id, observation_id, source_text, source_low, source_high,
          source_unit, laboratory_out_of_range, normalized_low, normalized_high,
          normalized_unit, conversion_version, created_at)
       VALUES ($1, $2, $3, 'synthetic reference', NULL, NULL,
               'synthetic-unit', NULL, NULL, NULL, NULL, NULL, $4)`,
    [rangeId, fixture.familyId, observationId, now],
  );

  return { decisionId, observationId, rangeId, requestId };
}

async function insertConfirmedReviewGraph(
  database: Database,
  fixture: DocumentFixture,
  processing: ProcessingGraph,
  suffix: string,
): Promise<ReviewGraph> {
  return database.transaction((client) =>
    insertConfirmedReviewGraphRows(client, fixture, processing, suffix),
  );
}

async function createDeadLetterJob(
  database: Database,
  fixture: DocumentFixture,
  suffix: string,
): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await database.query(
    `INSERT INTO processing_jobs
       (id, family_id, document_version_id, kind, dedupe_key, payload_version,
        state, attempt_count, max_attempts, available_at,
        last_error_code, last_error_message, completed_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'document_extraction', $4,
             'document-extraction-job/v1', 'dead_letter', 3, 3, $5,
             'ATTEMPT_LIMIT', 'Processing attempt limit reached', $5, $5, $5)`,
    [id, fixture.familyId, fixture.documentVersionId, `dead-letter:${suffix}`, now],
  );
  return id;
}

async function insertProcessingRetryRequest(
  database: Database,
  input: {
    id?: string;
    familyId: string;
    actorUserId: string;
    documentVersionId: string;
    processingJobId: string;
    idempotencyKeyHash: string;
  },
): Promise<string> {
  const id = input.id ?? randomUUID();
  await database.query(
    `INSERT INTO processing_retry_requests
       (id, family_id, actor_user_id, document_version_id, processing_job_id,
        idempotency_key_hash)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      input.familyId,
      input.actorUserId,
      input.documentVersionId,
      input.processingJobId,
      input.idempotencyKeyHash,
    ],
  );
  return id;
}

async function rejectsConstraint(
  operation: () => Promise<unknown>,
  kind: "check" | "foreign-key" | "trigger" | "unique",
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => isSqliteConstraintError(error, kind));
}

test("all migrations apply, populated processing data rolls back, and migrations reapply", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "veylta-migrations-"));
  const database = createDatabase(join(testRoot, "test.sqlite"));
  try {
    await migrateUp(database);
    const applied = await database.query<{ value: string }>(
      "SELECT value FROM service_metadata WHERE key = 'foundation_version'",
    );
    assert.equal(applied.rows[0]?.value, "1");
    assert.equal(await tableExists(database, "users"), true);
    assert.equal(await tableExists(database, "documents"), true);
    assert.equal(await tableExists(database, "processing_jobs"), true);
    assert.equal(await tableExists(database, "processing_retry_requests"), true);
    assert.equal(await tableExists(database, "extraction_runs"), true);
    assert.equal(await tableExists(database, "document_pages"), true);
    assert.equal(await tableExists(database, "extracted_facts"), true);
    assert.equal(await tableExists(database, "review_decisions"), true);
    assert.equal(await tableExists(database, "review_requests"), true);
    assert.equal(await tableExists(database, "observations"), true);
    assert.equal(await tableExists(database, "observation_reference_ranges"), true);
    await assert.doesNotReject(() => database.check());

    const document = await createDocumentFixture(database, "Synthetic populated rollback");
    const processing = await insertProcessingGraph(database, document, "populated-rollback");
    await insertConfirmedReviewGraph(database, document, processing, "populated-rollback");
    const retryJobId = await createDeadLetterJob(database, document, "populated-rollback");
    await insertProcessingRetryRequest(database, {
      familyId: document.familyId,
      actorUserId: document.userId,
      documentVersionId: document.documentVersionId,
      processingJobId: retryJobId,
      idempotencyKeyHash: "d".repeat(64),
    });

    assert.equal(await migrateDown(database), "0006_audit_log_integrity");
    assert.equal(await tableExists(database, "audit_events"), true);

    assert.equal(await migrateDown(database), "0005_review_observations");
    assert.equal(await tableExists(database, "review_decisions"), false);
    assert.equal(await tableExists(database, "review_requests"), false);
    assert.equal(await tableExists(database, "observations"), false);
    assert.equal(await tableExists(database, "observation_reference_ranges"), false);
    assert.equal(await tableExists(database, "processing_jobs"), true);
    assert.equal(await tableExists(database, "extracted_facts"), true);

    assert.equal(await migrateDown(database), "0004_processing");
    assert.equal(await tableExists(database, "processing_jobs"), false);
    assert.equal(await tableExists(database, "processing_retry_requests"), false);
    assert.equal(await tableExists(database, "extraction_runs"), false);
    assert.equal(await tableExists(database, "document_pages"), false);
    assert.equal(await tableExists(database, "extracted_facts"), false);
    assert.equal(await tableExists(database, "documents"), true);
    const preservedDocument = await database.query<{ id: string }>(
      "SELECT id FROM document_versions WHERE id = $1 AND family_id = $2",
      [document.documentVersionId, document.familyId],
    );
    assert.equal(preservedDocument.rowCount, 1);

    assert.equal(await migrateDown(database), "0003_documents");
    assert.equal(await tableExists(database, "documents"), false);
    await assert.rejects(
      () => database.check(),
      /Current database schema migration is not available/,
    );

    assert.equal(await migrateDown(database), "0002_family_profiles");
    assert.equal(await tableExists(database, "users"), false);

    assert.equal(await migrateDown(database), "0001_foundation");
    assert.equal(await tableExists(database, "service_metadata"), false);

    assert.deepEqual(await migrateUp(database), [
      "0001_foundation",
      "0002_family_profiles",
      "0003_documents",
      "0004_processing",
      "0005_review_observations",
      "0006_audit_log_integrity",
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

test("audit events are append-only after the audit-log integrity migration", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "veylta-audit-integrity-"));
  const database = createDatabase(join(testRoot, "test.sqlite"));
  try {
    await migrateUp(database);
    const fixture = await createDocumentFixture(database, "Synthetic audit integrity");
    const eventId = randomUUID();
    await database.query(
      `INSERT INTO audit_events
         (id, family_id, actor_user_id, action, resource_type, resource_id, result,
          correlation_id, metadata, created_at)
       VALUES ($1, $2, $3, 'synthetic.audit.created', 'SyntheticResource', $4, 'success',
               'synthetic-audit-correlation', '{"contractVersion":"audit-log/v1"}', $5)`,
      [eventId, fixture.familyId, fixture.userId, fixture.profileId, "2026-08-12T12:00:00.000Z"],
    );

    await rejectsConstraint(
      () => database.query("UPDATE audit_events SET action = 'changed' WHERE id = $1", [eventId]),
      "trigger",
    );
    await rejectsConstraint(
      () => database.query("DELETE FROM audit_events WHERE id = $1", [eventId]),
      "trigger",
    );
    const stored = await database.query<{ action: string }>(
      "SELECT action FROM audit_events WHERE id = $1",
      [eventId],
    );
    assert.deepEqual(stored.rows, [{ action: "synthetic.audit.created" }]);
  } finally {
    await database.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("processing schema enforces tenant, state, dedupe, and immutable provenance invariants", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "veylta-processing-schema-"));
  const database = createDatabase(join(testRoot, "test.sqlite"));
  try {
    await migrateUp(database);
    const first = await createDocumentFixture(database, "Synthetic first");
    const second = await createDocumentFixture(database, "Synthetic second");
    const graph = await insertProcessingGraph(database, first, "stable-dedupe");
    const now = new Date().toISOString();

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO processing_jobs
             (id, family_id, document_version_id, kind, dedupe_key, payload_version,
              state, attempt_count, max_attempts, available_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'document_extraction', 'cross-tenant',
                   'document-extraction-job/v1', 'pending', 0, 3, $4, $4, $4)`,
          [randomUUID(), second.familyId, first.documentVersionId, now],
        ),
      "foreign-key",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO processing_jobs
             (id, family_id, document_version_id, kind, dedupe_key, payload_version,
              state, attempt_count, max_attempts, available_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'document_extraction', 'extract:stable-dedupe',
                   'document-extraction-job/v1', 'pending', 0, 3, $4, $4, $4)`,
          [randomUUID(), second.familyId, second.documentVersionId, now],
        ),
      "unique",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO processing_jobs
             (id, family_id, document_version_id, kind, dedupe_key, payload_version,
              state, attempt_count, max_attempts, available_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'document_extraction', 'invalid-lease',
                   'document-extraction-job/v1', 'leased', 1, 3, $4, $4, $4)`,
          [randomUUID(), first.familyId, first.documentVersionId, now],
        ),
      "check",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO processing_jobs
             (id, family_id, document_version_id, kind, dedupe_key, payload_version,
              state, current_stage, attempt_count, max_attempts, available_at, lease_owner,
              lease_expires_at, created_at, updated_at)
           VALUES ($1, $2, $3, 'document_extraction', 'invalid-stage',
                   'document-extraction-job/v1', 'leased', 'not_a_public_stage',
                   1, 3, $4, 'worker-test', $5, $4, $4)`,
          [
            randomUUID(),
            first.familyId,
            first.documentVersionId,
            now,
            new Date(Date.now() + 60_000).toISOString(),
          ],
        ),
      "check",
    );

    const invalidJobShapes = [
      {
        dedupe: "pending-with-attempt",
        state: "pending",
        currentStage: null,
        attemptCount: 1,
        maxAttempts: 3,
        availableAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      },
      {
        dedupe: "leased-past-limit",
        state: "leased",
        currentStage: "security_check",
        attemptCount: 4,
        maxAttempts: 3,
        availableAt: now,
        leaseOwner: "worker-test",
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      },
      {
        dedupe: "retry-without-error",
        state: "retry_wait",
        currentStage: null,
        attemptCount: 1,
        maxAttempts: 3,
        availableAt: new Date(Date.now() + 60_000).toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      },
      {
        dedupe: "retry-at-limit",
        state: "retry_wait",
        currentStage: null,
        attemptCount: 3,
        maxAttempts: 3,
        availableAt: new Date(Date.now() + 60_000).toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: "TRANSIENT_FAILURE",
        errorMessage: "Synthetic transient failure",
        completedAt: null,
      },
      {
        dedupe: "success-without-completion",
        state: "succeeded",
        currentStage: null,
        attemptCount: 1,
        maxAttempts: 3,
        availableAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      },
      {
        dedupe: "dead-letter-before-limit",
        state: "dead_letter",
        currentStage: null,
        attemptCount: 2,
        maxAttempts: 3,
        availableAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: "ATTEMPT_LIMIT",
        errorMessage: "Synthetic terminal failure",
        completedAt: now,
      },
      {
        dedupe: "pending-with-stage",
        state: "pending",
        currentStage: "security_check",
        attemptCount: 0,
        maxAttempts: 3,
        availableAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      },
      {
        dedupe: "leased-without-stage",
        state: "leased",
        currentStage: null,
        attemptCount: 1,
        maxAttempts: 3,
        availableAt: now,
        leaseOwner: "worker-test",
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        errorCode: null,
        errorMessage: null,
        completedAt: null,
      },
      {
        dedupe: "retry-with-stage",
        state: "retry_wait",
        currentStage: "security_check",
        attemptCount: 1,
        maxAttempts: 3,
        availableAt: new Date(Date.now() + 60_000).toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: "TRANSIENT_FAILURE",
        errorMessage: "Synthetic transient failure",
        completedAt: null,
      },
      {
        dedupe: "success-with-stage",
        state: "succeeded",
        currentStage: "security_check",
        attemptCount: 1,
        maxAttempts: 3,
        availableAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        completedAt: now,
      },
      {
        dedupe: "dead-letter-with-stage",
        state: "dead_letter",
        currentStage: "security_check",
        attemptCount: 3,
        maxAttempts: 3,
        availableAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: "ATTEMPT_LIMIT",
        errorMessage: "Synthetic terminal failure",
        completedAt: now,
      },
    ] as const;

    for (const shape of invalidJobShapes) {
      await rejectsConstraint(
        () =>
          database.query(
            `INSERT INTO processing_jobs
               (id, family_id, document_version_id, kind, dedupe_key, payload_version,
                state, current_stage, attempt_count, max_attempts, available_at, lease_owner,
                lease_expires_at, last_error_code, last_error_message, completed_at,
                created_at, updated_at)
             VALUES ($1, $2, $3, 'document_extraction', $4,
                     'document-extraction-job/v1', $5, $6, $7, $8, $9, $10, $11,
                     $12, $13, $14, $15, $15)`,
            [
              randomUUID(),
              first.familyId,
              first.documentVersionId,
              shape.dedupe,
              shape.state,
              shape.currentStage,
              shape.attemptCount,
              shape.maxAttempts,
              shape.availableAt,
              shape.leaseOwner,
              shape.leaseExpiresAt,
              shape.errorCode,
              shape.errorMessage,
              shape.completedAt,
              now,
            ],
          ),
        "check",
      );
    }

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO extraction_runs
             (id, family_id, document_version_id, job_id, extractor_kind,
              extractor_version, output_schema_version, status, created_at)
           VALUES ($1, $2, $3, $4, 'deterministic_pdf_text', '1',
                   'lab-extraction/v1', 'queued', $5)`,
          [randomUUID(), second.familyId, second.documentVersionId, graph.jobId, now],
        ),
      "foreign-key",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO document_pages
             (id, family_id, document_version_id, page_number, extracted_text,
              extraction_method, extraction_version, text_sha256, created_at)
           VALUES ($1, $2, $3, 1, 'duplicate page', 'pdf_text_layer', '1', $4, $5)`,
          [randomUUID(), first.familyId, first.documentVersionId, "b".repeat(64), now],
        ),
      "unique",
    );

    const secondGraph = await insertProcessingGraph(database, second, "other-document");
    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO extracted_facts
             (id, family_id, document_version_id, extraction_run_id, document_page_id, fact_key,
              source_fragment, source_name, source_value, source_unit, confidence,
              validation_issues, review_status, created_at)
           VALUES ($1, $2, $3, $4, $5, 'mismatched-page', 'source', 'name', '1',
                   'unit', 0.9, '[]', 'extracted', $6)`,
          [
            randomUUID(),
            first.familyId,
            first.documentVersionId,
            graph.runId,
            secondGraph.pageId,
            now,
          ],
        ),
      "foreign-key",
    );

    const otherDocumentVersionId = await createAnotherDocumentVersion(
      database,
      first,
      "Synthetic same-family second document",
    );
    const otherPageId = randomUUID();
    await database.query(
      `INSERT INTO document_pages
         (id, family_id, document_version_id, page_number, extracted_text,
          extraction_method, extraction_version, text_sha256, created_at)
       VALUES ($1, $2, $3, 1, 'other document page', 'pdf_text_layer', '1', $4, $5)`,
      [otherPageId, first.familyId, otherDocumentVersionId, "c".repeat(64), now],
    );
    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO extracted_facts
             (id, family_id, document_version_id, extraction_run_id, document_page_id, fact_key,
              source_fragment, source_name, source_value, source_unit, confidence,
              validation_issues, review_status, created_at)
           VALUES ($1, $2, $3, $4, $5, 'same-family-mismatched-page', 'source',
                   'name', '1', 'unit', 0.9, '[]', 'extracted', $6)`,
          [randomUUID(), first.familyId, first.documentVersionId, graph.runId, otherPageId, now],
        ),
      "foreign-key",
    );

    await rejectsConstraint(
      () =>
        database.query("UPDATE document_pages SET extracted_text = 'changed' WHERE id = $1", [
          graph.pageId,
        ]),
      "trigger",
    );

    await rejectsConstraint(
      () =>
        database.query("UPDATE extracted_facts SET source_value = 'changed' WHERE id = $1", [
          graph.factId,
        ]),
      "trigger",
    );

    await rejectsConstraint(
      () =>
        database.query("UPDATE extracted_facts SET review_status = 'extracted' WHERE id = $1", [
          graph.factId,
        ]),
      "trigger",
    );
    const immutableSource = await database.query<{ review_status: string; source_value: string }>(
      "SELECT review_status, source_value FROM extracted_facts WHERE id = $1",
      [graph.factId],
    );
    assert.deepEqual(immutableSource.rows[0], {
      review_status: "needs_review",
      source_value: "7.0",
    });

    await rejectsConstraint(
      () => database.query("DELETE FROM extracted_facts WHERE id = $1", [graph.factId]),
      "trigger",
    );

    const transitionTime = (offset: number): string => new Date(Date.now() + offset).toISOString();
    const leasedAt = transitionTime(60_000);
    const leased = await database.query(
      `UPDATE processing_jobs
          SET state = 'leased', current_stage = 'security_check', attempt_count = 1,
              lease_owner = 'worker-test',
              lease_expires_at = $1, updated_at = $2
        WHERE id = $3 AND state = 'pending'`,
      [leasedAt, now, graph.jobId],
    );
    assert.equal(leased.rowCount, 1);

    for (const stage of [
      "security_check",
      "text_extraction",
      "document_classification",
      "structured_extraction",
      "validation",
    ] as const) {
      const progressed = await database.query(
        "UPDATE processing_jobs SET current_stage = $1 WHERE id = $2 AND state = 'leased'",
        [stage, graph.jobId],
      );
      assert.equal(progressed.rowCount, 1);
    }

    const retryWait = await database.query(
      `UPDATE processing_jobs
          SET state = 'retry_wait', current_stage = NULL, lease_owner = NULL, lease_expires_at = NULL,
              last_error_code = 'TRANSIENT_FAILURE',
              last_error_message = 'Synthetic transient failure',
              available_at = $1, updated_at = $2
        WHERE id = $3 AND state = 'leased'`,
      [transitionTime(120_000), transitionTime(61_000), graph.jobId],
    );
    assert.equal(retryWait.rowCount, 1);

    const secondLease = await database.query(
      `UPDATE processing_jobs
          SET state = 'leased', current_stage = 'text_extraction', attempt_count = 2,
              lease_owner = 'worker-test',
              lease_expires_at = $1, last_error_code = NULL,
              last_error_message = NULL, updated_at = $2
        WHERE id = $3 AND state = 'retry_wait'`,
      [transitionTime(180_000), transitionTime(120_000), graph.jobId],
    );
    assert.equal(secondLease.rowCount, 1);

    const secondRetryWait = await database.query(
      `UPDATE processing_jobs
          SET state = 'retry_wait', current_stage = NULL, lease_owner = NULL, lease_expires_at = NULL,
              last_error_code = 'TRANSIENT_FAILURE',
              last_error_message = 'Synthetic transient failure again',
              available_at = $1, updated_at = $2
        WHERE id = $3 AND state = 'leased'`,
      [transitionTime(240_000), transitionTime(181_000), graph.jobId],
    );
    assert.equal(secondRetryWait.rowCount, 1);

    const finalLease = await database.query(
      `UPDATE processing_jobs
          SET state = 'leased', current_stage = 'validation', attempt_count = 3,
              lease_owner = 'worker-test',
              lease_expires_at = $1, last_error_code = NULL,
              last_error_message = NULL, updated_at = $2
        WHERE id = $3 AND state = 'retry_wait'`,
      [transitionTime(300_000), transitionTime(240_000), graph.jobId],
    );
    assert.equal(finalLease.rowCount, 1);

    const deadLettered = await database.query(
      `UPDATE processing_jobs
          SET state = 'dead_letter', attempt_count = max_attempts,
              current_stage = NULL, lease_owner = NULL, lease_expires_at = NULL,
              last_error_code = 'ATTEMPT_LIMIT',
              last_error_message = 'Synthetic processing failed',
              completed_at = $1, updated_at = $1
        WHERE id = $2 AND state = 'leased'`,
      [transitionTime(241_000), graph.jobId],
    );
    assert.equal(deadLettered.rowCount, 1);
    const visibleTerminalState = await database.query<{ state: string }>(
      "SELECT state FROM processing_jobs WHERE id = $1",
      [graph.jobId],
    );
    assert.equal(visibleTerminalState.rows[0]?.state, "dead_letter");

    const foreignKeyViolations = await database.query<Record<string, unknown>>(
      "PRAGMA foreign_key_check",
    );
    assert.deepEqual(foreignKeyViolations.rows, []);
  } finally {
    await database.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("review schema makes a final fact decision, confirmed observation, source range, and request atomic", async () => {
  const testRoot = await mkdtemp(join(tmpdir(), "veylta-review-schema-"));
  const database = createDatabase(join(testRoot, "test.sqlite"));
  try {
    await migrateUp(database);
    const first = await createDocumentFixture(database, "Synthetic review first");
    const second = await createDocumentFixture(database, "Synthetic review second");
    const firstProcessing = await insertProcessingGraph(database, first, "review-first");
    const secondProcessing = await insertProcessingGraph(database, second, "review-second");
    const now = new Date().toISOString();

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO review_decisions
             (id, family_id, extracted_fact_id, source_fact_version, outcome,
              corrected_source_name, corrected_source_value, corrected_source_unit,
              observation_id, decided_by_user_id, decided_at, created_at)
           VALUES ($1, $2, $3, 2, 'reject', NULL, NULL, NULL, NULL, $4, $5, $5)`,
          [randomUUID(), first.familyId, firstProcessing.factId, first.userId, now],
        ),
      "check",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO review_decisions
             (id, family_id, extracted_fact_id, source_fact_version, outcome,
              corrected_source_name, corrected_source_value, corrected_source_unit,
              observation_id, decided_by_user_id, decided_at, created_at)
           VALUES ($1, $2, $3, 1, 'correct', NULL, NULL, NULL, $4, $5, $6, $6)`,
          [randomUUID(), first.familyId, firstProcessing.factId, randomUUID(), first.userId, now],
        ),
      "trigger",
    );

    const malformedCorrectProcessing = await insertProcessingGraph(
      database,
      first,
      "review-malformed-correct",
      2,
    );
    const malformedCorrectDecisionId = randomUUID();
    await rejectsConstraint(
      () =>
        database.transaction(async (client) => {
          const malformedCorrectObservationId = randomUUID();
          await client.query(
            `INSERT INTO observations
               (id, family_id, patient_profile_id, document_id, document_version_id,
                document_page_id, source_extracted_fact_id, source_fact_version,
                review_decision_id, status, source_name, source_value, source_unit,
                uploaded_at, source_fragment, extraction_confidence, confirmed_by_user_id,
                confirmed_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, 'confirmed',
                     'SYNTHETIC_ANALYTE_A', '7.0', 'synthetic-unit', $9,
                     'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit', 0.6, $10, $9, $9)`,
            [
              malformedCorrectObservationId,
              first.familyId,
              first.profileId,
              first.documentId,
              first.documentVersionId,
              malformedCorrectProcessing.pageId,
              malformedCorrectProcessing.factId,
              malformedCorrectDecisionId,
              now,
              first.userId,
            ],
          );
          await client.query(
            `INSERT INTO review_decisions
               (id, family_id, extracted_fact_id, source_fact_version, outcome,
                corrected_source_name, corrected_source_value, corrected_source_unit,
                observation_id, decided_by_user_id, decided_at, created_at)
             VALUES ($1, $2, $3, 1, 'correct', NULL, NULL, NULL, $4, $5, $6, $6)`,
            [
              malformedCorrectDecisionId,
              first.familyId,
              malformedCorrectProcessing.factId,
              malformedCorrectObservationId,
              first.userId,
              now,
            ],
          );
        }),
      "check",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO observations
             (id, family_id, patient_profile_id, document_id, document_version_id,
              document_page_id, source_extracted_fact_id, source_fact_version,
              review_decision_id, status, source_name, source_value, source_unit,
              uploaded_at, source_fragment, extraction_confidence, confirmed_by_user_id,
              confirmed_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, 'confirmed',
                   'SYNTHETIC_ANALYTE_A', '7.0', 'synthetic-unit', $9,
                   'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit', 0.6, $10, $9, $9)`,
          [
            randomUUID(),
            first.familyId,
            first.profileId,
            first.documentId,
            first.documentVersionId,
            malformedCorrectProcessing.pageId,
            firstProcessing.factId,
            randomUUID(),
            now,
            first.userId,
          ],
        ),
      "foreign-key",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO review_decisions
             (id, family_id, extracted_fact_id, source_fact_version, outcome,
              corrected_source_name, corrected_source_value, corrected_source_unit,
              observation_id, decided_by_user_id, decided_at, created_at)
           VALUES ($1, $2, $3, 1, 'reject', NULL, NULL, NULL, $4, $5, $6, $6)`,
          [randomUUID(), first.familyId, firstProcessing.factId, randomUUID(), first.userId, now],
        ),
      "check",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO review_decisions
             (id, family_id, extracted_fact_id, source_fact_version, outcome,
              corrected_source_name, corrected_source_value, corrected_source_unit,
              observation_id, decided_by_user_id, decided_at, created_at)
           VALUES ($1, $2, $3, 1, 'confirm', NULL, NULL, NULL, $4, $5, $6, $6)`,
          [randomUUID(), first.familyId, firstProcessing.factId, randomUUID(), first.userId, now],
        ),
      "trigger",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO observations
             (id, family_id, patient_profile_id, document_id, document_version_id,
              document_page_id, source_extracted_fact_id, source_fact_version,
              review_decision_id, status, source_name, source_value, source_unit,
              uploaded_at, source_fragment, extraction_confidence, confirmed_by_user_id,
              confirmed_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, 'confirmed',
                   'SYNTHETIC_ANALYTE_A', '7.0', 'synthetic-unit', $9,
                   'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit', 0.6, $10, $9, $9)`,
          [
            randomUUID(),
            first.familyId,
            first.profileId,
            first.documentId,
            first.documentVersionId,
            firstProcessing.pageId,
            firstProcessing.factId,
            randomUUID(),
            now,
            first.userId,
          ],
        ),
      "foreign-key",
    );

    const rejectedProcessing = await insertProcessingGraph(database, first, "review-rejected", 3);
    const rejectedDecisionId = randomUUID();
    await database.query(
      `INSERT INTO review_decisions
         (id, family_id, extracted_fact_id, source_fact_version, outcome,
          corrected_source_name, corrected_source_value, corrected_source_unit,
          observation_id, decided_by_user_id, decided_at, created_at)
       VALUES ($1, $2, $3, 1, 'reject', NULL, NULL, NULL, NULL, $4, $5, $5)`,
      [rejectedDecisionId, first.familyId, rejectedProcessing.factId, first.userId, now],
    );
    const rejectedOutput = await database.query<{
      decision_count: number;
      observation_count: number;
    }>(
      `SELECT
         (SELECT count(*) FROM review_decisions WHERE id = $1) AS decision_count,
         (SELECT count(*) FROM observations WHERE source_extracted_fact_id = $2) AS observation_count`,
      [rejectedDecisionId, rejectedProcessing.factId],
    );
    assert.deepEqual(rejectedOutput.rows, [{ decision_count: 1, observation_count: 0 }]);

    const stagedProcessing = await insertProcessingGraph(
      database,
      first,
      "review-reject-staged-observation",
      4,
    );

    await rejectsConstraint(
      () =>
        database.transaction(async (client) => {
          const stagedObservationId = randomUUID();
          const stagedDecisionId = randomUUID();
          await client.query(
            `INSERT INTO observations
               (id, family_id, patient_profile_id, document_id, document_version_id,
                document_page_id, source_extracted_fact_id, source_fact_version,
                review_decision_id, status, source_name, source_value, source_unit,
                uploaded_at, source_fragment, extraction_confidence, confirmed_by_user_id,
                confirmed_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, 'confirmed',
                     'SYNTHETIC_ANALYTE_A', '7.0', 'synthetic-unit', $9,
                     'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit', 0.6, $10, $9, $9)`,
            [
              stagedObservationId,
              first.familyId,
              first.profileId,
              first.documentId,
              first.documentVersionId,
              stagedProcessing.pageId,
              stagedProcessing.factId,
              stagedDecisionId,
              now,
              first.userId,
            ],
          );
          await client.query(
            `INSERT INTO review_decisions
               (id, family_id, extracted_fact_id, source_fact_version, outcome,
                corrected_source_name, corrected_source_value, corrected_source_unit,
                observation_id, decided_by_user_id, decided_at, created_at)
             VALUES ($1, $2, $3, 1, 'reject', NULL, NULL, NULL, NULL, $4, $5, $5)`,
            [stagedDecisionId, first.familyId, stagedProcessing.factId, first.userId, now],
          );
        }),
      "trigger",
    );

    const rejectedThenObserved = await insertProcessingGraph(
      database,
      first,
      "review-reject-then-observation",
      5,
    );
    const rejectedThenObservedDecisionId = randomUUID();
    await database.query(
      `INSERT INTO review_decisions
         (id, family_id, extracted_fact_id, source_fact_version, outcome,
          corrected_source_name, corrected_source_value, corrected_source_unit,
          observation_id, decided_by_user_id, decided_at, created_at)
       VALUES ($1, $2, $3, 1, 'reject', NULL, NULL, NULL, NULL, $4, $5, $5)`,
      [
        rejectedThenObservedDecisionId,
        first.familyId,
        rejectedThenObserved.factId,
        first.userId,
        now,
      ],
    );
    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO observations
             (id, family_id, patient_profile_id, document_id, document_version_id,
              document_page_id, source_extracted_fact_id, source_fact_version,
              review_decision_id, status, source_name, source_value, source_unit,
              uploaded_at, source_fragment, extraction_confidence, confirmed_by_user_id,
              confirmed_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, 'confirmed',
                   'SYNTHETIC_ANALYTE_A', '7.0', 'synthetic-unit', $9,
                   'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit', 0.6, $10, $9, $9)`,
          [
            randomUUID(),
            first.familyId,
            first.profileId,
            first.documentId,
            first.documentVersionId,
            rejectedThenObserved.pageId,
            rejectedThenObserved.factId,
            rejectedThenObservedDecisionId,
            now,
            first.userId,
          ],
        ),
      "trigger",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO observations
             (id, family_id, patient_profile_id, document_id, document_version_id,
              document_page_id, source_extracted_fact_id, source_fact_version,
              review_decision_id, status, source_name, source_value, source_unit,
              uploaded_at, source_fragment, extraction_confidence, confirmed_by_user_id,
              confirmed_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, 'confirmed',
                   'SYNTHETIC_ANALYTE_A', '7.0', 'synthetic-unit', $9,
                   'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit', 0.6, $10, $9, $9)`,
          [
            randomUUID(),
            second.familyId,
            second.profileId,
            second.documentId,
            second.documentVersionId,
            secondProcessing.pageId,
            firstProcessing.factId,
            randomUUID(),
            now,
            second.userId,
          ],
        ),
      "foreign-key",
    );

    const review = await insertConfirmedReviewGraph(
      database,
      first,
      firstProcessing,
      "review-confirmed",
    );
    const persisted = await database.query<{
      outcome: string;
      observation_id: string;
      source_extracted_fact_id: string;
      source_value: string;
    }>(
      `SELECT decision.outcome, decision.observation_id, observation.source_extracted_fact_id,
              observation.source_value
         FROM review_decisions AS decision
         JOIN observations AS observation ON observation.id = decision.observation_id
        WHERE decision.id = $1`,
      [review.decisionId],
    );
    assert.deepEqual(persisted.rows, [
      {
        outcome: "confirm",
        observation_id: review.observationId,
        source_extracted_fact_id: firstProcessing.factId,
        source_value: "7.0",
      },
    ]);

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO review_decisions
             (id, family_id, extracted_fact_id, source_fact_version, outcome,
              corrected_source_name, corrected_source_value, corrected_source_unit,
              observation_id, decided_by_user_id, decided_at, created_at)
           VALUES ($1, $2, $3, 1, 'reject', NULL, NULL, NULL, NULL, $4, $5, $5)`,
          [randomUUID(), first.familyId, firstProcessing.factId, first.userId, now],
        ),
      "unique",
    );

    await rejectsConstraint(
      () =>
        database.query("UPDATE review_decisions SET outcome = 'reject' WHERE id = $1", [
          review.decisionId,
        ]),
      "trigger",
    );
    await rejectsConstraint(
      () =>
        database.query("UPDATE observations SET source_value = '7.1' WHERE id = $1", [
          review.observationId,
        ]),
      "trigger",
    );
    await rejectsConstraint(
      () =>
        database.query(
          "UPDATE observation_reference_ranges SET source_text = 'changed' WHERE id = $1",
          [review.rangeId],
        ),
      "trigger",
    );
    await rejectsConstraint(
      () => database.query("DELETE FROM review_requests WHERE id = $1", [review.requestId]),
      "trigger",
    );

    await rejectsConstraint(
      () =>
        database.query(
          `INSERT INTO review_requests
             (id, family_id, actor_user_id, extracted_fact_id, review_decision_id,
              idempotency_key_hash, request_hash, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            first.familyId,
            first.userId,
            firstProcessing.factId,
            review.decisionId,
            Buffer.from("review:review-confirmed").toString("hex").padEnd(64, "0").slice(0, 64),
            "a".repeat(64),
            now,
          ],
        ),
      "unique",
    );

    const rolledBackProcessing = await insertProcessingGraph(database, first, "review-rollback", 6);
    await assert.rejects(
      () =>
        database.transaction(async (client) => {
          await insertConfirmedReviewGraphRows(
            client,
            first,
            rolledBackProcessing,
            "review-rolled-back",
          );
          throw new Error("force review transaction rollback");
        }),
      /force review transaction rollback/,
    );
    const rolledBackRows = await database.query<{
      decision_count: number;
      observation_count: number;
      request_count: number;
      range_count: number;
    }>(
      `SELECT
         (SELECT count(*) FROM review_decisions WHERE extracted_fact_id = $1) AS decision_count,
         (SELECT count(*) FROM observations WHERE source_extracted_fact_id = $1) AS observation_count,
         (SELECT count(*) FROM review_requests WHERE extracted_fact_id = $1) AS request_count,
         (SELECT count(*)
            FROM observation_reference_ranges AS reference_range
            JOIN observations ON observations.id = reference_range.observation_id
           WHERE observations.source_extracted_fact_id = $1) AS range_count`,
      [rolledBackProcessing.factId],
    );
    assert.deepEqual(rolledBackRows.rows, [
      { decision_count: 0, observation_count: 0, request_count: 0, range_count: 0 },
    ]);

    const foreignKeyViolations = await database.query<Record<string, unknown>>(
      "PRAGMA foreign_key_check",
    );
    assert.deepEqual(foreignKeyViolations.rows, []);
  } finally {
    await database.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});
