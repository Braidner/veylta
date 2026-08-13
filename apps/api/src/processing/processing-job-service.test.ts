import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrateUp } from "../database/migrations.js";
import { createDatabase, type Database } from "../database/pool.js";
import {
  createProcessingJobService,
  enqueueDocumentExtractionInTransaction,
  InvalidProcessingOutputError,
  InvalidProcessingStageTransitionError,
  ProcessingPersistenceConflictError,
  StaleProcessingLeaseError,
} from "./processing-job-service.js";
import { type ParsedLabExtraction, parseSyntheticLabPages } from "./synthetic-lab-parser.js";

interface DocumentFixture {
  documentId: string;
  familyId: string;
  documentVersionId: string;
  profileId: string;
  userId: string;
}

const start = new Date("2026-08-12T08:00:00.000Z");

function after(milliseconds: number): Date {
  return new Date(start.getTime() + milliseconds);
}

function parsedExtraction(): ParsedLabExtraction {
  return parseSyntheticLabPages([
    {
      pageNumber: 1,
      text: [
        "VEYLTA SYNTHETIC LAB REPORT v1",
        "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
        "FACT|synthetic-analyte-a",
        "NAME|СИНТЕТИЧЕСКИЙ АНАЛИТ A",
        "VALUE|7.0",
        "UNIT|synthetic-unit",
        "RANGE|synthetic reference",
        "CONFIDENCE|0.60",
        "ISSUES|AMBIGUOUS_UNIT",
        "END",
      ].join("\n"),
      extractionMethod: "pdf_text_layer",
      extractionVersion: "pdfjs-dist/6.2.108",
    },
  ]);
}

function highConfidenceExtraction(): ParsedLabExtraction {
  return parseSyntheticLabPages([
    {
      pageNumber: 1,
      text: [
        "VEYLTA SYNTHETIC LAB REPORT v1",
        "SYNTHETIC TEST DATA — NOT FOR MEDICAL USE",
        "FACT|synthetic-analyte-high",
        "NAME|SYNTHETIC HIGH-CONFIDENCE ANALYTE",
        "VALUE|7.0",
        "UNIT|synthetic-unit",
        "RANGE|synthetic reference",
        "CONFIDENCE|0.95",
        "ISSUES|NONE",
        "END",
      ].join("\n"),
      extractionMethod: "pdf_text_layer",
      extractionVersion: "pdfjs-dist/6.2.108",
    },
  ]);
}

async function advanceToValidation(
  jobs: ReturnType<typeof createProcessingJobService>,
  claim: NonNullable<
    Awaited<ReturnType<ReturnType<typeof createProcessingJobService>["claimNext"]>>
  >,
  offset = 1,
): Promise<void> {
  const stages = [
    "text_extraction",
    "document_classification",
    "structured_extraction",
    "validation",
  ] as const;
  for (const [index, stage] of stages.entries()) {
    await jobs.advanceStage(claim, stage, after(offset + index));
  }
}

async function createDocumentFixture(database: Database): Promise<DocumentFixture> {
  const userId = randomUUID();
  const familyId = randomUUID();
  const profileId = randomUUID();
  const blobId = randomUUID();
  const documentId = randomUUID();
  const documentVersionId = randomUUID();
  const now = start.toISOString();
  const checksum = createHash("sha256").update("synthetic processing fixture").digest("hex");

  await database.transaction(async (client) => {
    await client.query("INSERT INTO users (id, display_name, created_at) VALUES ($1, $2, $3)", [
      userId,
      "Synthetic processing owner",
      now,
    ]);
    await client.query(
      "INSERT INTO families (id, display_name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)",
      [familyId, "Synthetic processing family", userId, now],
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
      [profileId, familyId, "Synthetic processing profile", userId, now],
    );
    await client.query(
      `INSERT INTO document_blobs
         (id, family_id, storage_contract_version, storage_key, content_type,
          byte_size, sha256, created_at)
       VALUES ($1, $2, 'object-storage/v1', $3, 'application/pdf', 8, $4, $5)`,
      [blobId, familyId, `family_${familyId}/sha256_${checksum}`, checksum, now],
    );
    await client.query(
      `INSERT INTO documents
         (id, family_id, patient_profile_id, status, original_filename,
          uploaded_by_user_id, uploaded_at)
       VALUES ($1, $2, $3, 'uploaded', 'synthetic-processing.pdf', $4, $5)`,
      [documentId, familyId, profileId, userId, now],
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

interface AuditEventRow {
  action: string;
  actor_user_id: string;
  correlation_id: string;
  metadata: string;
  resource_id: string;
  resource_type: string;
  result: string;
}

async function auditEvents(database: Database): Promise<AuditEventRow[]> {
  return (
    await database.query<AuditEventRow>(
      `SELECT action, actor_user_id, correlation_id, metadata, resource_id, resource_type, result
         FROM audit_events
        ORDER BY created_at, id`,
    )
  ).rows;
}

async function withDatabase(
  operation: (database: Database, fixture: DocumentFixture) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "veylta-processing-jobs-"));
  const database = createDatabase(join(root, "test.sqlite"));
  try {
    await migrateUp(database);
    await operation(database, await createDocumentFixture(database));
  } finally {
    await database.close();
    await rm(root, { force: true, recursive: true });
  }
}

test("enqueue uses a stable document/version dedupe key", async () => {
  await withDatabase(async (database, fixture) => {
    const jobs = createProcessingJobService(database);

    const first = await jobs.enqueueDocumentExtraction({ ...fixture, now: start });
    const replay = await jobs.enqueueDocumentExtraction({ ...fixture, now: after(1_000) });

    assert.equal(replay.id, first.id);
    assert.equal(first.kind, "document_extraction");
    assert.equal(first.payloadVersion, "document-extraction-job/v1");
    assert.equal(first.state, "pending");
    const stored = await database.query<{ count: number }>(
      "SELECT count(*) AS count FROM processing_jobs",
    );
    assert.equal(Number(stored.rows[0]?.count), 1);
  });
});

test("transaction-scoped enqueue composes with upload persistence without a nested transaction", async () => {
  await withDatabase(async (database, fixture) => {
    const job = await database.transaction((client) =>
      enqueueDocumentExtractionInTransaction(client, { ...fixture, now: start }),
    );

    assert.equal(job.familyId, fixture.familyId);
    assert.equal(job.documentVersionId, fixture.documentVersionId);
    assert.equal(job.state, "pending");
  });
});

test("claim is exclusive and a prior lease owner is stale after reclaim", async () => {
  await withDatabase(async (database, fixture) => {
    const jobs = createProcessingJobService(database);
    await jobs.enqueueDocumentExtraction({ ...fixture, now: start });

    const first = await jobs.claimNext({
      workerId: "worker-a",
      now: start,
      leaseDurationMs: 60_000,
    });
    assert.ok(first !== null);
    assert.equal(first.attemptCount, 1);
    assert.equal(first.currentStage, "security_check");
    assert.match(first.leaseOwner, /^worker-a:/);
    assert.equal(
      await jobs.claimNext({ workerId: "worker-b", now: after(59_999), leaseDurationMs: 60_000 }),
      null,
    );

    const reclaimed = await jobs.claimNext({
      workerId: "worker-b",
      now: after(60_000),
      leaseDurationMs: 60_000,
    });
    assert.ok(reclaimed !== null);
    assert.equal(reclaimed.attemptCount, 2);
    assert.notEqual(reclaimed.leaseOwner, first.leaseOwner);

    await assert.rejects(
      jobs.completeExtraction(first, parsedExtraction(), after(60_001)),
      StaleProcessingLeaseError,
    );
    const partialRows = await database.query<{ count: number }>(
      `SELECT
         (SELECT count(*) FROM extraction_runs) +
         (SELECT count(*) FROM document_pages) +
         (SELECT count(*) FROM extracted_facts) AS count`,
    );
    assert.equal(Number(partialRows.rows[0]?.count), 0);
  });
});

test("active stages advance only under the current unexpired lease", async () => {
  await withDatabase(async (database, fixture) => {
    const jobs = createProcessingJobService(database);
    await jobs.enqueueDocumentExtraction({ ...fixture, now: start });
    const claim = await jobs.claimNext({
      workerId: "worker-a",
      now: start,
      leaseDurationMs: 1_000,
    });
    assert.ok(claim !== null);

    await assert.rejects(
      jobs.advanceStage(claim, "structured_extraction", after(100)),
      InvalidProcessingStageTransitionError,
    );
    const advanced = await jobs.advanceStage(claim, "text_extraction", after(100));
    assert.equal(advanced.currentStage, "text_extraction");
    await assert.rejects(
      jobs.advanceStage(claim, "validation", after(1_000)),
      StaleProcessingLeaseError,
    );
  });
});

test("failures wait for retry and exhaust into a visible dead-letter state", async () => {
  await withDatabase(async (database, fixture) => {
    const jobs = createProcessingJobService(database);
    await jobs.enqueueDocumentExtraction({ ...fixture, now: start, maxAttempts: 2 });
    const first = await jobs.claimNext({
      workerId: "worker-a",
      now: start,
      leaseDurationMs: 10_000,
    });
    assert.ok(first !== null);

    const retry = await jobs.recordFailure(first, {
      now: after(100),
      errorCode: "EXTRACTION_FAILED",
      retryDelayMs: 1_000,
    });
    assert.equal(retry.state, "retry_wait");
    assert.equal(retry.lastErrorMessage, "Document text extraction failed");
    assert.equal(
      await jobs.claimNext({ workerId: "worker-b", now: after(1_099), leaseDurationMs: 10_000 }),
      null,
    );

    const second = await jobs.claimNext({
      workerId: "worker-b",
      now: after(1_100),
      leaseDurationMs: 10_000,
    });
    assert.ok(second !== null);
    assert.equal(second.attemptCount, 2);
    const terminal = await jobs.recordFailure(second, {
      now: after(1_200),
      errorCode: "VALIDATION_FAILED",
      retryDelayMs: 1_000,
    });
    assert.equal(terminal.state, "dead_letter");
    assert.equal(terminal.completedAt, after(1_200).toISOString());
    assert.equal(terminal.lastErrorMessage, "Extraction output validation failed");
    const events = await auditEvents(database);
    assert.deepEqual(
      events.map(
        ({ action, actor_user_id, correlation_id, resource_id, resource_type, result }) => ({
          action,
          actorUserId: actor_user_id,
          correlationId: correlation_id,
          resourceId: resource_id,
          resourceType: resource_type,
          result,
        }),
      ),
      [
        {
          action: "document.processing.retry_scheduled",
          actorUserId: fixture.userId,
          correlationId: `worker:${first.id}`,
          resourceId: fixture.documentId,
          resourceType: "Document",
          result: "success",
        },
        {
          action: "document.processing.failed",
          actorUserId: fixture.userId,
          correlationId: `worker:${second.id}`,
          resourceId: fixture.documentId,
          resourceType: "Document",
          result: "success",
        },
      ],
    );
    assert.deepEqual(
      events.map((event) => JSON.parse(event.metadata)),
      [
        {
          automated: true,
          contractVersion: "document/v3",
          errorCode: "EXTRACTION_FAILED",
          outcome: "retry_wait",
        },
        {
          automated: true,
          contractVersion: "document/v3",
          errorCode: "VALIDATION_FAILED",
          outcome: "dead_letter",
        },
      ],
    );
  });
});

test("an expired final attempt is dead-lettered instead of remaining leased forever", async () => {
  await withDatabase(async (database, fixture) => {
    const jobs = createProcessingJobService(database);
    const job = await jobs.enqueueDocumentExtraction({ ...fixture, now: start, maxAttempts: 1 });
    assert.ok(
      (await jobs.claimNext({ workerId: "worker-a", now: start, leaseDurationMs: 1_000 })) !== null,
    );

    assert.equal(
      await jobs.claimNext({ workerId: "worker-b", now: after(1_000), leaseDurationMs: 1_000 }),
      null,
    );
    const stored = await jobs.getJob({ familyId: fixture.familyId, jobId: job.id });
    assert.equal(stored?.state, "dead_letter");
    assert.equal(stored?.lastErrorCode, "ATTEMPT_LIMIT");
    const events = await auditEvents(database);
    assert.deepEqual(
      events.map(({ action, correlation_id, metadata, resource_id }) => ({
        action,
        correlationId: correlation_id,
        metadata: JSON.parse(metadata),
        resourceId: resource_id,
      })),
      [
        {
          action: "document.processing.failed",
          correlationId: `worker:${job.id}`,
          metadata: {
            automated: true,
            contractVersion: "document/v3",
            errorCode: "ATTEMPT_LIMIT",
            outcome: "dead_letter",
          },
          resourceId: fixture.documentId,
        },
      ],
    );
  });
});

test("completion atomically persists provenance once and is idempotent on acknowledgement replay", async () => {
  await withDatabase(async (database, fixture) => {
    const jobs = createProcessingJobService(database);
    await jobs.enqueueDocumentExtraction({ ...fixture, now: start });
    const claim = await jobs.claimNext({
      workerId: "worker-a",
      now: start,
      leaseDurationMs: 60_000,
    });
    assert.ok(claim !== null);
    await advanceToValidation(jobs, claim);

    const first = await jobs.completeExtraction(claim, parsedExtraction(), after(500));
    const replay = await jobs.completeExtraction(claim, parsedExtraction(), after(600));

    assert.equal(first.status, "completed");
    assert.equal(replay.status, "already_completed");
    assert.equal(replay.extractionRunId, first.extractionRunId);
    assert.equal(first.factCount, 1);
    assert.equal(first.needsReviewCount, 1);
    const counts = await database.query<{
      facts: number;
      jobs: number;
      pages: number;
      runs: number;
    }>(
      `SELECT
         (SELECT count(*) FROM processing_jobs WHERE state = 'succeeded') AS jobs,
         (SELECT count(*) FROM extraction_runs) AS runs,
         (SELECT count(*) FROM document_pages) AS pages,
         (SELECT count(*) FROM extracted_facts) AS facts`,
    );
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(counts.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
      ),
      { jobs: 1, runs: 1, pages: 1, facts: 1 },
    );
    const events = await auditEvents(database);
    assert.equal(events.length, 1);
    assert.deepEqual(
      {
        action: events[0]?.action,
        actorUserId: events[0]?.actor_user_id,
        correlationId: events[0]?.correlation_id,
        resourceId: events[0]?.resource_id,
        resourceType: events[0]?.resource_type,
        result: events[0]?.result,
      },
      {
        action: "document.processing.completed",
        actorUserId: fixture.userId,
        correlationId: `worker:${claim.id}`,
        resourceId: fixture.documentId,
        resourceType: "Document",
        result: "success",
      },
    );
    assert.deepEqual(JSON.parse(events[0]?.metadata ?? ""), {
      automated: true,
      contractVersion: "document/v3",
      outcome: "completed",
    });
    assert.doesNotMatch(events[0]?.metadata ?? "", /synthetic-analyte-a|reference|7\.0/i);
  });
});

test("completion keeps a high-confidence extraction awaiting an explicit final review", async () => {
  await withDatabase(async (database, fixture) => {
    const jobs = createProcessingJobService(database);
    await jobs.enqueueDocumentExtraction({ ...fixture, now: start });
    const claim = await jobs.claimNext({
      workerId: "worker-high-confidence",
      now: start,
      leaseDurationMs: 60_000,
    });
    assert.ok(claim !== null);
    await advanceToValidation(jobs, claim);

    const completion = await jobs.completeExtraction(claim, highConfidenceExtraction(), after(500));
    assert.deepEqual(
      {
        status: completion.status,
        factCount: completion.factCount,
        needsReviewCount: completion.needsReviewCount,
      },
      { status: "completed", factCount: 1, needsReviewCount: 0 },
    );

    const persisted = await database.query<{
      run_status: string;
      review_status: string;
      decisions: number;
      observations: number;
    }>(
      `SELECT r.status AS run_status, f.review_status,
              (SELECT count(*) FROM review_decisions WHERE family_id = $1) AS decisions,
              (SELECT count(*) FROM observations WHERE family_id = $1) AS observations
         FROM extraction_runs r
         JOIN extracted_facts f
           ON f.family_id = r.family_id AND f.extraction_run_id = r.id
        WHERE r.family_id = $1 AND r.document_version_id = $2`,
      [fixture.familyId, fixture.documentVersionId],
    );
    assert.deepEqual(persisted.rows, [
      {
        run_status: "awaiting_review",
        review_status: "extracted",
        decisions: 0,
        observations: 0,
      },
    ]);
  });
});

test("missing or cross-tenant document source rolls back a processing outcome and audit event", async () => {
  for (const corruption of ["missing", "cross_tenant"] as const) {
    await withDatabase(async (database, fixture) => {
      const jobs = createProcessingJobService(database);
      await jobs.enqueueDocumentExtraction({ ...fixture, now: start });
      const claim = await jobs.claimNext({
        workerId: "worker-a",
        now: start,
        leaseDurationMs: 60_000,
      });
      assert.ok(claim !== null);
      await advanceToValidation(jobs, claim);

      await database.exec("PRAGMA foreign_keys = OFF");
      if (corruption === "missing") {
        await database.query("DELETE FROM documents WHERE id = $1", [fixture.documentId]);
      } else {
        const otherFamilyId = randomUUID();
        await database.query(
          "INSERT INTO families (id, display_name, created_by_user_id, created_at) VALUES ($1, $2, $3, $4)",
          [otherFamilyId, "Other synthetic family", fixture.userId, start.toISOString()],
        );
        await database.query("UPDATE documents SET family_id = $1 WHERE id = $2", [
          otherFamilyId,
          fixture.documentId,
        ]);
      }
      await database.exec("PRAGMA foreign_keys = ON");

      await assert.rejects(
        jobs.completeExtraction(claim, parsedExtraction(), after(500)),
        ProcessingPersistenceConflictError,
      );
      const job = await jobs.getJob({ familyId: fixture.familyId, jobId: claim.id });
      assert.equal(job?.state, "leased");
      const counts = await database.query<{
        audit_events: number;
        facts: number;
        pages: number;
        runs: number;
      }>(
        `SELECT
           (SELECT count(*) FROM audit_events) AS audit_events,
           (SELECT count(*) FROM extraction_runs) AS runs,
           (SELECT count(*) FROM document_pages) AS pages,
           (SELECT count(*) FROM extracted_facts) AS facts`,
      );
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(counts.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
        ),
        { audit_events: 0, facts: 0, pages: 0, runs: 0 },
      );
    });
  }
});

test("an archive racing a leased job blocks its extraction graph and successful audit", async () => {
  await withDatabase(async (database, fixture) => {
    const jobs = createProcessingJobService(database);
    await jobs.enqueueDocumentExtraction({ ...fixture, now: start });
    const claim = await jobs.claimNext({
      workerId: "worker-a",
      now: start,
      leaseDurationMs: 60_000,
    });
    assert.ok(claim !== null);
    await advanceToValidation(jobs, claim);

    await database.query(
      "UPDATE patient_profiles SET archived_at = $1 WHERE id = $2 AND family_id = $3",
      [after(400), fixture.profileId, fixture.familyId],
    );

    await assert.rejects(
      jobs.completeExtraction(claim, parsedExtraction(), after(500)),
      ProcessingPersistenceConflictError,
    );
    const job = await jobs.getJob({ familyId: fixture.familyId, jobId: claim.id });
    assert.equal(job?.state, "leased");
    const persisted = await database.query<{
      audits: number;
      facts: number;
      pages: number;
      runs: number;
    }>(
      `SELECT
         (SELECT count(*) FROM audit_events) AS audits,
         (SELECT count(*) FROM extraction_runs) AS runs,
         (SELECT count(*) FROM document_pages) AS pages,
         (SELECT count(*) FROM extracted_facts) AS facts`,
    );
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(persisted.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]),
      ),
      { audits: 0, facts: 0, pages: 0, runs: 0 },
    );
  });
});

test("invalid output cannot leave a partial medical graph or complete the job", async () => {
  await withDatabase(async (database, fixture) => {
    const jobs = createProcessingJobService(database);
    await jobs.enqueueDocumentExtraction({ ...fixture, now: start });
    const claim = await jobs.claimNext({
      workerId: "worker-a",
      now: start,
      leaseDurationMs: 60_000,
    });
    assert.ok(claim !== null);
    await advanceToValidation(jobs, claim);
    const valid = parsedExtraction();
    const firstFact = valid.extraction.items[0];
    assert.ok(firstFact !== undefined);
    const invalid: ParsedLabExtraction = {
      ...valid,
      extraction: {
        ...valid.extraction,
        items: [{ ...firstFact, confidence: 2 }],
      },
    };

    await assert.rejects(
      jobs.completeExtraction(claim, invalid, after(500)),
      InvalidProcessingOutputError,
    );
    const state = await jobs.getJob({ familyId: fixture.familyId, jobId: claim.id });
    assert.equal(state?.state, "leased");
    const partialRows = await database.query<{ count: number }>(
      `SELECT
         (SELECT count(*) FROM extraction_runs) +
         (SELECT count(*) FROM document_pages) +
         (SELECT count(*) FROM extracted_facts) AS count`,
    );
    assert.equal(Number(partialRows.rows[0]?.count), 0);
  });
});
