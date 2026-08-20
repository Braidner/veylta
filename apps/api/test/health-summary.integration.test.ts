import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION,
  HEALTH_SUMMARY_CONTRACT_VERSION,
  type HealthSummaryComparisonResponse,
  type HealthSummaryResponse,
} from "@veylta/contracts";
import { createDocumentExtractionProcessor } from "../src/processing/document-extraction-processor.js";
import { createLocalObjectStorage } from "../src/storage/local-object-storage.js";
import { type DocumentTestContext, withDocumentContext } from "./document-app.js";
import { type Identity, register, webOrigin } from "./family-app.js";

const fixtureUrl = new URL("../../../fixtures/veylta-synthetic-lab-report.pdf", import.meta.url);

interface PreparedDocument {
  documentId: string;
  facts: Array<{ id: string; factVersion: number; factKey: string }>;
}

function profilePath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
}

function documentPath(identity: Identity, documentId: string): string {
  return `${profilePath(identity)}/documents/${documentId}`;
}

function summaryPath(identity: Identity): string {
  return `${profilePath(identity)}/health-summary`;
}

function summaryHistoryPath(identity: Identity): string {
  return `${summaryPath(identity)}/versions`;
}

function summaryComparisonPath(identity: Identity): string {
  return `${summaryPath(identity)}/compare`;
}

function multipartFile(bytes: Buffer, filename: string) {
  const boundary = `veylta-summary-${randomUUID()}`;
  return {
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function uploadAndExtract(
  context: DocumentTestContext,
  owner: Identity,
  suffix: string,
): Promise<PreparedDocument> {
  const fixture = await readFile(fixtureUrl);
  const source = Buffer.concat([fixture, Buffer.from(`\n% ${suffix}\n`)]);
  const multipart = multipartFile(source, `${suffix}.pdf`);
  const upload = await context.app.inject({
    method: "POST",
    url: `${profilePath(owner)}/documents`,
    headers: {
      cookie: owner.cookie,
      origin: webOrigin,
      "content-type": multipart.contentType,
      "idempotency-key": `summary-upload-${randomUUID()}`,
    },
    payload: multipart.body,
  });
  assert.equal(upload.statusCode, 202, upload.rawPayload.toString());
  const documentId = upload.json().document.id as string;
  const processor = createDocumentExtractionProcessor({
    database: context.database,
    storage: createLocalObjectStorage(context.storageRoot),
  });
  assert.equal(
    (
      await processor.processNext({
        workerId: `summary-worker-${randomUUID()}`,
        leaseDurationMs: 60_000,
        retryDelayMs: 1,
      })
    ).status,
    "completed",
  );
  const facts = await context.app.inject({
    method: "GET",
    url: `${documentPath(owner, documentId)}/facts`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(facts.statusCode, 200);
  return { documentId, facts: facts.json().items };
}

async function decide(
  context: DocumentTestContext,
  owner: Identity,
  documentId: string,
  factId: string,
  factVersion: number,
  decision: "confirm" | "reject",
): Promise<void> {
  const response = await context.app.inject({
    method: "POST",
    url: `${documentPath(owner, documentId)}/facts/${factId}/review`,
    headers: {
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": `summary-review-${randomUUID()}`,
    },
    payload: { factVersion, decision },
  });
  assert.equal(response.statusCode, 201, response.rawPayload.toString());
}

test("health summary snapshots only final confirmed evidence and remains profile-authorized", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Summary");
    const outsider = await register(context.app, "Summary outsider");

    const before = await context.app.inject({
      method: "GET",
      url: summaryPath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(before.statusCode, 200);
    assert.deepEqual(before.json(), {
      contractVersion: HEALTH_SUMMARY_CONTRACT_VERSION,
      summary: null,
    });

    const prepared = await uploadAndExtract(context, owner, "first-summary");
    const confirmed = prepared.facts.find((fact) => fact.factKey === "synthetic-analyte-a");
    const rejected = prepared.facts.find((fact) => fact.factKey === "synthetic-analyte-b");
    if (confirmed === undefined || rejected === undefined)
      throw new Error("Expected fixture facts");
    await decide(
      context,
      owner,
      prepared.documentId,
      confirmed.id,
      confirmed.factVersion,
      "confirm",
    );
    await decide(context, owner, prepared.documentId, rejected.id, rejected.factVersion, "reject");

    const response = await context.app.inject({
      method: "GET",
      url: summaryPath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200, response.rawPayload.toString());
    assert.equal(response.headers["cache-control"], "no-store");
    const result = response.json() as HealthSummaryResponse;
    assert.equal(result.contractVersion, HEALTH_SUMMARY_CONTRACT_VERSION);
    if (result.summary === null) throw new Error("Expected a summary after final review");
    assert.equal(result.summary.version, 1);
    assert.equal(result.summary.previous, null);
    assert.deepEqual(result.summary.evidenceScope, {
      includedCount: 1,
      totalConfirmedObservationCount: 1,
    });
    assert.equal(result.summary.groups.length, 1);
    assert.deepEqual(
      result.summary.groups[0]?.evidence.map((item) => ({
        value: item.observation.source.value,
        isNew: item.isNewSincePreviousSummary,
      })),
      [{ value: "7.0", isNew: true }],
    );
    assert.deepEqual(result.summary.recommendations, [{ code: "prepare_source_for_clinician" }]);
    assert.deepEqual(result.summary.missingData, ["laboratory", "result_date", "sample_date"]);
    assert.equal(result.summary.redFlagStatus, "not_evaluated");

    const audit = await context.database.query<{ metadata: string }>(
      `SELECT metadata FROM audit_events
        WHERE family_id = $1 AND action = 'profile.health_summary.opened'`,
      [owner.body.family.id],
    );
    assert.deepEqual(
      audit.rows.map((row) => JSON.parse(row.metadata)),
      [
        { contractVersion: HEALTH_SUMMARY_CONTRACT_VERSION },
        { contractVersion: HEALTH_SUMMARY_CONTRACT_VERSION },
      ],
    );

    const denied = await context.app.inject({
      method: "GET",
      url: summaryPath(owner),
      headers: { cookie: outsider.cookie },
    });
    assert.equal(denied.statusCode, 404);
    assert.equal(denied.rawPayload.includes(owner.body.profile.id), false);
    assert.equal(denied.rawPayload.includes("7.0"), false);
  });
});

test("a later completed review creates an immutable successor and identifies new evidence", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Summary versions");
    const first = await uploadAndExtract(context, owner, "first-version");
    const firstConfirmed = first.facts.find((fact) => fact.factKey === "synthetic-analyte-a");
    const firstRejected = first.facts.find((fact) => fact.factKey === "synthetic-analyte-b");
    if (firstConfirmed === undefined || firstRejected === undefined)
      throw new Error("Expected first facts");
    await decide(
      context,
      owner,
      first.documentId,
      firstConfirmed.id,
      firstConfirmed.factVersion,
      "confirm",
    );
    await decide(
      context,
      owner,
      first.documentId,
      firstRejected.id,
      firstRejected.factVersion,
      "reject",
    );

    const firstSummaryResponse = await context.app.inject({
      method: "GET",
      url: summaryPath(owner),
      headers: { cookie: owner.cookie },
    });
    const firstSummary = (firstSummaryResponse.json() as HealthSummaryResponse).summary;
    if (firstSummary === null) throw new Error("Expected initial summary");

    const second = await uploadAndExtract(context, owner, "second-version");
    const secondConfirmed = second.facts.find((fact) => fact.factKey === "synthetic-analyte-a");
    const secondRejected = second.facts.find((fact) => fact.factKey === "synthetic-analyte-b");
    if (secondConfirmed === undefined || secondRejected === undefined)
      throw new Error("Expected second facts");
    await decide(
      context,
      owner,
      second.documentId,
      secondConfirmed.id,
      secondConfirmed.factVersion,
      "confirm",
    );
    await decide(
      context,
      owner,
      second.documentId,
      secondRejected.id,
      secondRejected.factVersion,
      "reject",
    );

    const response = await context.app.inject({
      method: "GET",
      url: summaryPath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200);
    const latest = (response.json() as HealthSummaryResponse).summary;
    if (latest === null) throw new Error("Expected successor summary");
    assert.equal(latest.version, 2);
    assert.deepEqual(latest.previous, {
      id: firstSummary.id,
      version: 1,
      createdAt: firstSummary.createdAt,
    });
    assert.deepEqual(latest.evidenceScope, {
      includedCount: 2,
      totalConfirmedObservationCount: 2,
    });
    assert.equal(latest.newEvidenceCount, 1);
    assert.equal(latest.carriedForwardEvidenceCount, 1);
    const summaryEvidence = latest.groups.flatMap((group) => group.evidence);
    assert.deepEqual(
      summaryEvidence.map((item) => item.isNewSincePreviousSummary),
      [true, false],
    );
    assert.equal(new Set(summaryEvidence.map((item) => item.observation.id)).size, 2);
    assert.equal(
      summaryEvidence.some((item) => item.observation.id === latest.id),
      false,
    );

    const snapshots = await context.database.query<{
      id: string;
      version: number;
      previous_summary_id: string | null;
      evidence_count: number;
    }>(
      `SELECT summary.id, summary.version, summary.previous_summary_id,
              count(evidence.observation_id) AS evidence_count
         FROM health_summaries summary
         JOIN health_summary_evidence evidence
           ON evidence.family_id = summary.family_id AND evidence.health_summary_id = summary.id
        WHERE summary.family_id = $1 AND summary.patient_profile_id = $2
        GROUP BY summary.id, summary.version, summary.previous_summary_id
        ORDER BY summary.version`,
      [owner.body.family.id, owner.body.profile.id],
    );
    assert.deepEqual(snapshots.rows, [
      { id: firstSummary.id, version: 1, previous_summary_id: null, evidence_count: 1 },
      { id: latest.id, version: 2, previous_summary_id: firstSummary.id, evidence_count: 2 },
    ]);

    const history = await context.app.inject({
      method: "GET",
      url: summaryHistoryPath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(history.statusCode, 200, history.rawPayload.toString());
    assert.deepEqual(history.json(), {
      contractVersion: "health-summary-history/v1",
      versions: [
        {
          id: latest.id,
          version: 2,
          createdAt: latest.createdAt,
          includedEvidenceCount: 2,
          totalConfirmedObservationCount: 2,
          newEvidenceCount: 1,
          carriedForwardEvidenceCount: 1,
        },
        {
          id: firstSummary.id,
          version: 1,
          createdAt: firstSummary.createdAt,
          includedEvidenceCount: 1,
          totalConfirmedObservationCount: 1,
          newEvidenceCount: 1,
          carriedForwardEvidenceCount: 0,
        },
      ],
      nextBeforeVersion: null,
    });

    const firstPage = await context.app.inject({
      method: "GET",
      url: `${summaryHistoryPath(owner)}?limit=1`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(firstPage.statusCode, 200, firstPage.rawPayload.toString());
    assert.deepEqual(firstPage.json(), {
      contractVersion: "health-summary-history/v1",
      versions: [
        {
          id: latest.id,
          version: 2,
          createdAt: latest.createdAt,
          includedEvidenceCount: 2,
          totalConfirmedObservationCount: 2,
          newEvidenceCount: 1,
          carriedForwardEvidenceCount: 1,
        },
      ],
      nextBeforeVersion: 2,
    });

    const secondPage = await context.app.inject({
      method: "GET",
      url: `${summaryHistoryPath(owner)}?limit=1&beforeVersion=2`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(secondPage.statusCode, 200, secondPage.rawPayload.toString());
    assert.deepEqual(secondPage.json(), {
      contractVersion: "health-summary-history/v1",
      versions: [
        {
          id: firstSummary.id,
          version: 1,
          createdAt: firstSummary.createdAt,
          includedEvidenceCount: 1,
          totalConfirmedObservationCount: 1,
          newEvidenceCount: 1,
          carriedForwardEvidenceCount: 0,
        },
      ],
      nextBeforeVersion: null,
    });

    const historical = await context.app.inject({
      method: "GET",
      url: `${summaryPath(owner)}?version=1`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(historical.statusCode, 200, historical.rawPayload.toString());
    const firstVersion = (historical.json() as HealthSummaryResponse).summary;
    if (firstVersion === null) throw new Error("Expected requested summary version");
    assert.equal(firstVersion.id, firstSummary.id);
    assert.equal(firstVersion.version, 1);
    assert.equal(firstVersion.previous, null);
    assert.deepEqual(firstVersion.evidenceScope, {
      includedCount: 1,
      totalConfirmedObservationCount: 1,
    });

    const comparison = await context.app.inject({
      method: "GET",
      url: `${summaryComparisonPath(owner)}?fromVersion=1&toVersion=2`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(comparison.statusCode, 200, comparison.rawPayload.toString());
    assert.equal(comparison.headers["cache-control"], "no-store");
    const comparisonBody = comparison.json() as HealthSummaryComparisonResponse;
    assert.equal(comparisonBody.contractVersion, HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION);
    assert.deepEqual(comparisonBody.base, {
      id: firstSummary.id,
      version: 1,
      createdAt: firstSummary.createdAt,
    });
    assert.deepEqual(comparisonBody.target, {
      id: latest.id,
      version: 2,
      createdAt: latest.createdAt,
    });
    assert.deepEqual(
      comparisonBody.newlyIncluded.map((item) => item.id),
      [summaryEvidence.find((item) => item.isNewSincePreviousSummary)?.observation.id],
    );
    assert.deepEqual(comparisonBody.noLongerIncluded, []);

    const comparisonAudit = await context.database.query<{ metadata: string }>(
      `SELECT metadata
         FROM audit_events
        WHERE family_id = $1 AND action = 'profile.health_summary_comparison.opened'`,
      [owner.body.family.id],
    );
    assert.deepEqual(
      comparisonAudit.rows.map((row) => JSON.parse(row.metadata)),
      [{ contractVersion: HEALTH_SUMMARY_COMPARISON_CONTRACT_VERSION }],
    );

    const reversedComparison = await context.app.inject({
      method: "GET",
      url: `${summaryComparisonPath(owner)}?fromVersion=2&toVersion=1`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(reversedComparison.statusCode, 422);

    const absentComparisonVersion = await context.app.inject({
      method: "GET",
      url: `${summaryComparisonPath(owner)}?fromVersion=1&toVersion=3`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(absentComparisonVersion.statusCode, 404);

    const absentVersion = await context.app.inject({
      method: "GET",
      url: `${summaryPath(owner)}?version=3`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(absentVersion.statusCode, 404);
    assert.equal(absentVersion.rawPayload.includes(owner.body.profile.id), false);

    const invalidVersion = await context.app.inject({
      method: "GET",
      url: `${summaryPath(owner)}?version=0`,
      headers: { cookie: owner.cookie },
    });
    assert.equal(invalidVersion.statusCode, 400);

    const outsider = await register(context.app, "summary-history-outsider");
    const deniedHistory = await context.app.inject({
      method: "GET",
      url: summaryHistoryPath(owner),
      headers: { cookie: outsider.cookie },
    });
    assert.equal(deniedHistory.statusCode, 404);
    assert.equal(deniedHistory.rawPayload.includes(firstSummary.id), false);

    const deniedComparison = await context.app.inject({
      method: "GET",
      url: `${summaryComparisonPath(owner)}?fromVersion=1&toVersion=2`,
      headers: { cookie: outsider.cookie },
    });
    assert.equal(deniedComparison.statusCode, 404);
    assert.equal(deniedComparison.rawPayload.includes(latest.id), false);

    const rejectedOnly = await uploadAndExtract(context, owner, "rejected-only");
    for (const fact of rejectedOnly.facts) {
      await decide(context, owner, rejectedOnly.documentId, fact.id, fact.factVersion, "reject");
    }
    const afterRejectedOnly = await context.app.inject({
      method: "GET",
      url: summaryPath(owner),
      headers: { cookie: owner.cookie },
    });
    const unchanged = (afterRejectedOnly.json() as HealthSummaryResponse).summary;
    if (unchanged === null) throw new Error("Expected the existing summary to remain available");
    assert.equal(unchanged.id, latest.id);
    assert.equal(unchanged.version, latest.version);
  });
});
