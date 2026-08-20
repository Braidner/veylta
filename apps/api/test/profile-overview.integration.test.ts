import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { ProfileOverviewResponse } from "@veylta/contracts";
import type { Database } from "../src/database/pool.js";
import {
  type DocumentTestContext,
  uploadAndExtract as uploadAndExtractDocument,
  withDocumentContext,
} from "./document-app.js";
import { type Identity, register } from "./family-app.js";

function profilePath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
}

function overviewPath(identity: Identity): string {
  return `${profilePath(identity)}/overview`;
}

async function uploadAndExtract(context: DocumentTestContext, owner: Identity): Promise<string> {
  const prepared = await uploadAndExtractDocument(context, owner, {
    filename: "overview-synthetic.pdf",
  });
  return prepared.documentId;
}

test("profile overview is source-first, bounded, and payload-free audited", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Overview");
    const documentId = await uploadAndExtract(context, owner);

    const response = await context.app.inject({
      method: "GET",
      url: overviewPath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200, response.rawPayload.toString());
    assert.equal(response.headers["cache-control"], "no-store");
    const overview = response.json() as ProfileOverviewResponse;
    assert.equal(overview.contractVersion, "profile-overview/v5");
    assert.equal(overview.profile.id, owner.body.profile.id);
    assert.equal(overview.reviewQueue.documentCount, 1);
    assert.equal(overview.reviewQueue.pendingFactCount, 2);
    assert.equal(overview.reviewQueue.needsAttentionFactCount, 1);
    assert.deepEqual(
      overview.reviewQueue.documents.map((document) => ({
        id: document.id,
        originalFilename: document.originalFilename,
        contentType: document.contentType,
        pendingFactCount: document.pendingFactCount,
        needsAttentionFactCount: document.needsAttentionFactCount,
      })),
      [
        {
          id: documentId,
          originalFilename: "overview-synthetic.pdf",
          contentType: "application/pdf",
          pendingFactCount: 2,
          needsAttentionFactCount: 1,
        },
      ],
    );
    assert.deepEqual([overview.documentCount, overview.recentDocuments.length], [1, 1]);
    const recent = overview.recentDocuments[0];
    assert.deepEqual(recent, {
      id: documentId,
      originalFilename: "overview-synthetic.pdf",
      contentType: "application/pdf",
      uploadedAt: recent?.uploadedAt,
      effectiveDate: { value: recent?.uploadedAt.slice(0, 10), source: "upload" },
      processing: recent?.processing,
      intelligence: null,
    });
    assert.equal(recent?.processing.state, "awaiting_review");
    assert.deepEqual(overview.recentObservations, []);

    const audit = await context.database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata
         FROM audit_events
        WHERE family_id = $1
          AND resource_id = $2
          AND action = 'profile.overview.opened'`,
      [owner.body.family.id, owner.body.profile.id],
    );
    assert.equal(audit.rows.length, 1);
    assert.deepEqual(JSON.parse(audit.rows[0]?.metadata ?? "{}"), {
      contractVersion: "profile-overview/v5",
    });
    assert.equal(JSON.stringify(audit.rows).includes("overview-synthetic.pdf"), false);
    assert.equal(JSON.stringify(audit.rows).includes("AMBIGUOUS_UNIT"), false);
  });
});

test("profile overview is non-disclosing outside the authorized profile scope", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Owner boundary");
    const outsider = await register(context.app, "Outsider boundary");
    await uploadAndExtract(context, owner);

    const response = await context.app.inject({
      method: "GET",
      url: overviewPath(owner),
      headers: { cookie: outsider.cookie },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "RESOURCE_NOT_FOUND");
    assert.equal(response.rawPayload.includes(owner.body.profile.id), false);
    assert.equal(response.rawPayload.includes("overview-synthetic.pdf"), false);
    assert.equal(response.rawPayload.includes("AMBIGUOUS_UNIT"), false);
  });
});

test("profile overview honors a revocable profile.read grant as read-only access", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Owner grant");
    const reader = await register(context.app, "Reader grant");

    await context.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO family_memberships
           (family_id, user_id, role, status, created_at)
         VALUES ($1, $2, 'caregiver', 'active', $3)`,
        [owner.body.family.id, reader.userId, new Date()],
      );
      await client.query(
        `INSERT INTO profile_consent_grants
           (id, family_id, patient_profile_id, grantee_user_id, capability, granted_by_user_id, created_at)
         VALUES ($1, $2, $3, $4, 'profile.read', $5, $6)`,
        [
          randomUUID(),
          owner.body.family.id,
          owner.body.profile.id,
          reader.userId,
          owner.userId,
          new Date(),
        ],
      );
    });

    const response = await context.app.inject({
      method: "GET",
      url: overviewPath(owner),
      headers: { cookie: reader.cookie },
    });
    assert.equal(response.statusCode, 200, response.rawPayload.toString());
    const overview = response.json() as ProfileOverviewResponse;
    assert.equal(overview.profile.access, "granted_read");
    assert.deepEqual(overview.recentDocuments, []);
    assert.equal(overview.reviewQueue.documentCount, 0);
  });
});

/**
 * Seeds one waiting source directly. The review queue is a projection over documents,
 * runs, facts and decisions; driving it through upload + OCR would test the extraction
 * pipeline instead, which its own suite already covers.
 */
async function seedWaitingDocument(
  database: Database,
  owner: Identity,
  label: string,
): Promise<void> {
  const now = new Date().toISOString();
  const familyId = owner.body.family.id;
  const profileId = owner.body.profile.id;
  const checksum = Buffer.from(label).toString("hex").padEnd(64, "0").slice(0, 64);
  const blobId = randomUUID();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const jobId = randomUUID();
  const runId = randomUUID();
  const pageId = randomUUID();

  await database.transaction(async (client) => {
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
      [documentId, familyId, profileId, `${label}.pdf`, owner.userId, now],
    );
    await client.query(
      `INSERT INTO document_versions
         (id, family_id, document_id, blob_id, version_number, created_at)
       VALUES ($1, $2, $3, $4, 1, $5)`,
      [versionId, familyId, documentId, blobId, now],
    );
    await client.query(
      `INSERT INTO processing_jobs
         (id, family_id, document_version_id, kind, dedupe_key, payload_version,
          state, attempt_count, max_attempts, available_at, completed_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'document_extraction', $4,
               'document-extraction-job/v1', 'succeeded', 1, 3, $5, $5, $5, $5)`,
      [jobId, familyId, versionId, `extract:${label}`, now],
    );
    await client.query(
      `INSERT INTO extraction_runs
         (id, family_id, document_version_id, job_id, extractor_kind,
          extractor_version, output_schema_version, status, started_at, completed_at, created_at)
       VALUES ($1, $2, $3, $4, 'deterministic_pdf_text', '1',
               'lab-extraction/v1', 'awaiting_review', $5, $5, $5)`,
      [runId, familyId, versionId, jobId, now],
    );
    await client.query(
      `INSERT INTO document_pages
         (id, family_id, document_version_id, page_number, extracted_text,
          extraction_method, extraction_version, text_sha256, created_at)
       VALUES ($1, $2, $3, 1, 'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit',
               'pdf_text_layer', '1', $4, $5)`,
      [pageId, familyId, versionId, checksum, now],
    );
    for (const [index, status] of ["extracted", "needs_review"].entries()) {
      await client.query(
        `INSERT INTO extracted_facts
           (id, family_id, document_version_id, extraction_run_id, document_page_id, fact_key,
            source_fragment, source_name, source_value, source_unit,
            proposed_canonical_code, proposed_normalized_value,
            proposed_normalized_unit, proposed_reference_range,
            proposed_specimen, proposed_sampled_at, proposed_resulted_at,
            proposed_laboratory, confidence, validation_issues, review_status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 'SYNTHETIC_ANALYTE_A 7.0 synthetic-unit', 'SYNTHETIC_ANALYTE_A',
                 '7.0', 'synthetic-unit', 'synthetic-analyte-a', NULL, NULL,
                 '{"sourceText":"synthetic reference","sourceLow":null,"sourceHigh":null,"sourceUnit":"synthetic-unit","laboratoryOutOfRange":null}',
                 'synthetic specimen', '2026-08-10T08:00:00.000Z',
                 '2026-08-10T10:00:00.000Z', 'Synthetic Laboratory',
                 0.6, $7, $8, $9)`,
        [
          randomUUID(),
          familyId,
          versionId,
          runId,
          pageId,
          `synthetic-analyte-${index}`,
          status === "needs_review" ? '["AMBIGUOUS_UNIT"]' : "[]",
          status,
          now,
        ],
      );
    }
  });
}

/**
 * The archive acts on this list directly, so it must carry every waiting source. A shorter
 * projection would make "confirm all" silently skip documents the user can see counted.
 */
test("the review queue returns every waiting source, not a three-document preview", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Queue");
    for (const label of ["alfa", "beta", "gamma", "delta"]) {
      await seedWaitingDocument(context.database, owner, `queue-${label}`);
    }

    const response = await context.app.inject({
      method: "GET",
      url: overviewPath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200, response.rawPayload.toString());
    const overview = response.json() as ProfileOverviewResponse;
    assert.equal(overview.reviewQueue.documentCount, 4);
    assert.equal(overview.reviewQueue.documents.length, 4);
    for (const document of overview.reviewQueue.documents) {
      assert.equal(document.pendingFactCount, 2);
      assert.equal(document.needsAttentionFactCount, 1);
    }
  });
});
