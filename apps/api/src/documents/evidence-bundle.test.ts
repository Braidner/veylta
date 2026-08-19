import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createSyntheticEvidenceBundle } from "./evidence-bundle.js";

function readTarEntries(bundle: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= bundle.byteLength) {
    const header = bundle.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("ascii"), 8);
    if (name.length === 0 || !Number.isSafeInteger(size) || size < 0) {
      throw new Error("Invalid tar fixture");
    }
    const bodyStart = offset + 512;
    entries.set(name, bundle.subarray(bodyStart, bodyStart + size));
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test("creates a safe tar with the manifest and immutable source bytes", () => {
  const manifest = {
    contractVersion: "synthetic-evidence-bundle/v1" as const,
    exportedAt: "2026-08-12T00:00:00.000Z",
    profile: {
      id: "00000000-0000-4000-8000-000000000001",
      familyId: "00000000-0000-4000-8000-000000000002",
      displayName: "Synthetic profile",
      handle: "synthetic-profile",
      kind: "adult" as const,
      createdAt: "2026-08-12T00:00:00.000Z",
    },
    documents: [
      {
        id: "00000000-0000-4000-8000-000000000003",
        versionId: "00000000-0000-4000-8000-000000000004",
        originalFilename: "source.pdf",
        contentType: "application/pdf" as const,
        byteSize: 9,
        sha256: createHash("sha256").update("%PDF-test").digest("hex"),
        uploadedAt: "2026-08-12T00:00:00.000Z",
        archivePath: "documents/00000000-0000-4000-8000-000000000003.pdf",
      },
    ],
    observations: [],
  };
  const document = manifest.documents[0];
  if (document === undefined) throw new Error("Expected an evidence document");
  const source = Buffer.from("%PDF-test", "utf8");

  const bundle = createSyntheticEvidenceBundle({
    manifest,
    sources: [{ path: document.archivePath, bytes: source }],
  });
  const entries = readTarEntries(bundle);

  assert.deepEqual([...entries.keys()], ["manifest.json", document.archivePath]);
  assert.deepEqual(entries.get(document.archivePath), source);
  assert.deepEqual(JSON.parse(entries.get("manifest.json")?.toString("utf8") ?? "{}"), manifest);
});

test("refuses a source whose bytes do not match its immutable manifest checksum", () => {
  const document = {
    id: "00000000-0000-4000-8000-000000000003",
    versionId: "00000000-0000-4000-8000-000000000004",
    originalFilename: "source.pdf",
    contentType: "application/pdf" as const,
    byteSize: 9,
    sha256: createHash("sha256").update("%PDF-test").digest("hex"),
    uploadedAt: "2026-08-12T00:00:00.000Z",
    archivePath: "documents/00000000-0000-4000-8000-000000000003.pdf",
  };
  const manifest = {
    contractVersion: "synthetic-evidence-bundle/v1" as const,
    exportedAt: "2026-08-12T00:00:00.000Z",
    profile: {
      id: "00000000-0000-4000-8000-000000000001",
      familyId: "00000000-0000-4000-8000-000000000002",
      displayName: "Synthetic profile",
      handle: "synthetic-profile",
      kind: "adult" as const,
      createdAt: "2026-08-12T00:00:00.000Z",
    },
    documents: [document],
    observations: [],
  };

  assert.throws(() =>
    createSyntheticEvidenceBundle({
      manifest,
      sources: [{ path: document.archivePath, bytes: Buffer.from("%PDF-bad", "utf8") }],
    }),
  );
});
