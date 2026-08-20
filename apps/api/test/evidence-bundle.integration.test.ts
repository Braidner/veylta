import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS,
  MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS,
} from "@veylta/contracts";
import {
  type DocumentTestContext,
  extractNextDocument,
  labReportFixtureUrl,
  uploadDocument,
  withDocumentContext,
} from "./document-app.js";
import { type Identity, register, webOrigin } from "./family-app.js";

function profilePath(identity: Identity): string {
  return `/v1/families/${identity.body.family.id}/profiles/${identity.body.profile.id}`;
}

function evidenceBundlePath(identity: Identity): string {
  return `${profilePath(identity)}/evidence-bundle`;
}

function portableProfileExportPath(identity: Identity): string {
  return `${profilePath(identity)}/portable-export`;
}

function documentPath(identity: Identity, documentId: string): string {
  return `${profilePath(identity)}/documents/${documentId}`;
}

async function uploadSource(
  context: DocumentTestContext,
  owner: Identity,
  filename = "evidence-source.pdf",
): Promise<string> {
  const fixture = await readFile(labReportFixtureUrl);
  const source = Buffer.concat([fixture, Buffer.from(`\n% ${filename}\n`)]);
  const uploaded = await uploadDocument(context.app, owner, source, `evidence_${randomUUID()}`, {
    filename,
  });
  assert.equal(uploaded.statusCode, 202);
  return uploaded.json().document.id as string;
}

async function uploadAndExtract(context: DocumentTestContext, owner: Identity): Promise<string> {
  const documentId = await uploadSource(context, owner);
  await extractNextDocument(context);
  return documentId;
}

async function confirmOneFact(
  context: DocumentTestContext,
  owner: Identity,
  documentId: string,
): Promise<void> {
  const facts = await context.app.inject({
    method: "GET",
    url: `${documentPath(owner, documentId)}/facts`,
    headers: { cookie: owner.cookie },
  });
  assert.equal(facts.statusCode, 200);
  const factId = facts.json().items[0]?.id as string | undefined;
  if (factId === undefined) throw new Error("Expected an extracted fact");
  const reviewed = await context.app.inject({
    method: "POST",
    url: `${documentPath(owner, documentId)}/facts/${factId}/review`,
    headers: {
      cookie: owner.cookie,
      origin: webOrigin,
      "idempotency-key": `evidence-review_${randomUUID()}`,
    },
    payload: { factVersion: 1, decision: "confirm" },
  });
  assert.equal(reviewed.statusCode, 201, reviewed.rawPayload.toString());
}

function tarEntries(bundle: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= bundle.length) {
    const header = bundle.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const path = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii"), 8);
    entries.set(path, bundle.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test("owner can export a bounded synthetic evidence bundle with source bytes and payload-free audit", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "Evidence");
    const documentId = await uploadAndExtract(context, owner);

    const response = await context.app.inject({
      method: "GET",
      url: evidenceBundlePath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200, response.rawPayload.toString());
    assert.equal(response.headers["content-type"], "application/x-tar");
    assert.equal(response.headers["cache-control"], "private, no-store");
    const entries = tarEntries(response.rawPayload);
    const manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "{}") as {
      contractVersion: string;
      documents: Array<{ id: string; archivePath: string; sha256: string }>;
    };
    assert.equal(manifest.contractVersion, "synthetic-evidence-bundle/v1");
    assert.deepEqual(
      manifest.documents.map((document) => document.id),
      [documentId],
    );
    const document = manifest.documents[0];
    if (document === undefined) throw new Error("Expected exported document");
    assert.equal(entries.get(document.archivePath)?.toString("binary").startsWith("%PDF-"), true);
    assert.equal(JSON.stringify(manifest).includes("storage_key"), false);

    const audit = await context.database.query<{ action: string; metadata: string }>(
      `SELECT action, metadata
         FROM audit_events
        WHERE family_id = $1 AND resource_id = $2 AND action = 'profile.evidence_bundle.exported'`,
      [owner.body.family.id, owner.body.profile.id],
    );
    assert.equal(audit.rows.length, 1);
    assert.deepEqual(JSON.parse(audit.rows[0]?.metadata ?? "{}"), {
      contractVersion: "synthetic-evidence-bundle/v1",
    });
    assert.equal(JSON.stringify(audit.rows).includes("evidence-source.pdf"), false);
  });
});

test("a profile.read grant cannot export either synthetic archive", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "owner grant");
    const reader = await register(context.app, "reader grant");
    await uploadAndExtract(context, owner);
    await context.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO family_memberships (family_id, user_id, role, status, created_at)
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
      url: evidenceBundlePath(owner),
      headers: { cookie: reader.cookie },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "RESOURCE_NOT_FOUND");

    const portableResponse = await context.app.inject({
      method: "GET",
      url: portableProfileExportPath(owner),
      headers: { cookie: reader.cookie },
    });
    assert.equal(portableResponse.statusCode, 404);
    assert.equal(portableResponse.json().error.code, "RESOURCE_NOT_FOUND");
  });
});

test("the local export is a bounded snapshot when a profile has more source documents", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "document bound");
    const olderDocumentId = await uploadAndExtract(context, owner);
    await confirmOneFact(context, owner, olderDocumentId);
    await context.database.query(`UPDATE documents SET uploaded_at = $1 WHERE id = $2`, [
      "2026-01-01T00:00:00.000Z",
      olderDocumentId,
    ]);
    for (let index = 1; index <= MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS; index += 1) {
      await uploadSource(context, owner, `evidence-bound-${index}.pdf`);
    }

    const response = await context.app.inject({
      method: "GET",
      url: evidenceBundlePath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200);
    const entries = tarEntries(response.rawPayload);
    const manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "{}") as {
      documents: Array<{ archivePath: string }>;
      observations: Array<{ sourceDocument: { id: string } }>;
    };
    assert.equal(manifest.documents.length, MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS);
    assert.equal(entries.size, MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS + 1);
    assert.equal(manifest.observations.length, 0);
    assert.equal(
      manifest.documents.some((document) => document.archivePath.includes(olderDocumentId)),
      false,
    );
    const audit = await context.database.query<{ id: string }>(
      `SELECT id FROM audit_events WHERE action = 'profile.evidence_bundle.exported'`,
    );
    assert.equal(audit.rows.length, 1);
  });
});

test("owner can export every synthetic source and confirmed record from one profile", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "portable profile");
    const firstDocumentId = await uploadAndExtract(context, owner);
    await confirmOneFact(context, owner, firstDocumentId);
    for (let index = 1; index <= MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS; index += 1) {
      await uploadSource(context, owner, `portable-source-${index}.pdf`);
    }

    const response = await context.app.inject({
      method: "GET",
      url: portableProfileExportPath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 200, response.rawPayload.toString());
    assert.equal(response.headers["content-type"], "application/x-tar");
    assert.equal(response.headers["cache-control"], "private, no-store");
    const entries = tarEntries(response.rawPayload);
    const manifest = JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "{}") as {
      contractVersion: string;
      documents: Array<{ id: string; archivePath: string }>;
      observations: Array<{ sourceDocument: { id: string; archivePath: string } }>;
    };
    assert.equal(manifest.contractVersion, "synthetic-profile-export/v1");
    assert.equal(manifest.documents.length, MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS + 1);
    assert.equal(entries.size, manifest.documents.length + 1);
    assert.equal(
      manifest.documents.some((document) => document.id === firstDocumentId),
      true,
    );
    assert.deepEqual(
      manifest.observations.map((observation) => observation.sourceDocument.id),
      [firstDocumentId],
    );
    assert.equal(
      manifest.observations[0]?.sourceDocument.archivePath,
      manifest.documents.find((document) => document.id === firstDocumentId)?.archivePath,
    );

    const audit = await context.database.query<{ metadata: string }>(
      `SELECT metadata
         FROM audit_events
        WHERE family_id = $1
          AND resource_id = $2
          AND action = 'profile.portable_export.exported'`,
      [owner.body.family.id, owner.body.profile.id],
    );
    assert.equal(audit.rows.length, 1);
    assert.deepEqual(JSON.parse(audit.rows[0]?.metadata ?? "{}"), {
      contractVersion: "synthetic-profile-export/v1",
    });
  });
});

test("portable profile export fails closed rather than silently omitting sources above its cap", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "portable cap");
    for (let index = 0; index <= MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS; index += 1) {
      await uploadSource(context, owner, `portable-cap-${index}.pdf`);
    }

    const response = await context.app.inject({
      method: "GET",
      url: portableProfileExportPath(owner),
      headers: { cookie: owner.cookie },
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error.code, "CONFLICT");
    assert.equal(response.rawPayload.includes("portable-cap-"), false);
    const audit = await context.database.query<{ id: string }>(
      `SELECT id
         FROM audit_events
        WHERE family_id = $1 AND action = 'profile.portable_export.exported'`,
      [owner.body.family.id],
    );
    assert.equal(audit.rows.length, 0);
  });
});

test("another family cannot discover a synthetic evidence bundle", async () => {
  await withDocumentContext(async (context) => {
    const owner = await register(context.app, "owner boundary");
    const outsider = await register(context.app, "outsider boundary");
    await uploadAndExtract(context, owner);

    const response = await context.app.inject({
      method: "GET",
      url: evidenceBundlePath(owner),
      headers: { cookie: outsider.cookie },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "RESOURCE_NOT_FOUND");
    assert.equal(response.rawPayload.includes(owner.body.profile.id), false);
    assert.equal(response.rawPayload.includes("evidence-source.pdf"), false);
  });
});
