import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSyntheticEvidenceBundle } from "./evidence-bundle.js";
import { verifyEvidenceBundleFile } from "./verify-evidence-bundle.js";

function bundle(): Buffer {
  const source = Buffer.from("%PDF-CLI", "utf8");
  const documentId = "00000000-0000-4000-8000-000000000003";
  return createSyntheticEvidenceBundle({
    manifest: {
      contractVersion: "synthetic-evidence-bundle/v1",
      exportedAt: "2026-08-12T00:00:00.000Z",
      profile: {
        id: "00000000-0000-4000-8000-000000000001",
        familyId: "00000000-0000-4000-8000-000000000002",
        displayName: "Synthetic profile",
        kind: "adult",
        createdAt: "2026-08-12T00:00:00.000Z",
      },
      documents: [
        {
          id: documentId,
          versionId: "00000000-0000-4000-8000-000000000004",
          originalFilename: "source.pdf",
          contentType: "application/pdf",
          byteSize: source.byteLength,
          sha256: createHash("sha256").update(source).digest("hex"),
          uploadedAt: "2026-08-12T00:00:00.000Z",
          archivePath: `documents/${documentId}.pdf`,
        },
      ],
      observations: [],
    },
    sources: [{ path: `documents/${documentId}.pdf`, bytes: source }],
  });
}

test("file verifier returns safe counts and never needs an extraction directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-bundle-verifier-"));
  const file = join(root, `${randomUUID()}.tar`);
  try {
    await writeFile(file, bundle());
    assert.deepEqual(await verifyEvidenceBundleFile(file), {
      contractVersion: "synthetic-evidence-bundle/v1",
      documentCount: 1,
      observationCount: 0,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("file verifier recognizes the separately versioned complete synthetic profile archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "veylta-profile-export-verifier-"));
  const file = join(root, `${randomUUID()}.tar`);
  try {
    const source = Buffer.from("%PDF-profile-export", "utf8");
    const documentId = "00000000-0000-4000-8000-000000000003";
    await writeFile(
      file,
      createSyntheticEvidenceBundle({
        manifest: {
          contractVersion: "synthetic-profile-export/v1",
          exportedAt: "2026-08-13T00:00:00.000Z",
          profile: {
            id: "00000000-0000-4000-8000-000000000001",
            familyId: "00000000-0000-4000-8000-000000000002",
            displayName: "Synthetic profile",
            kind: "adult",
            createdAt: "2026-08-12T00:00:00.000Z",
          },
          documents: [
            {
              id: documentId,
              versionId: "00000000-0000-4000-8000-000000000004",
              originalFilename: "source.pdf",
              contentType: "application/pdf",
              byteSize: source.byteLength,
              sha256: createHash("sha256").update(source).digest("hex"),
              uploadedAt: "2026-08-12T00:00:00.000Z",
              archivePath: `documents/${documentId}.pdf`,
            },
          ],
          observations: [],
        },
        sources: [{ path: `documents/${documentId}.pdf`, bytes: source }],
      }),
    );
    assert.deepEqual(await verifyEvidenceBundleFile(file), {
      contractVersion: "synthetic-profile-export/v1",
      documentCount: 1,
      observationCount: 0,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
