import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type {
  SyntheticDocumentContentType,
  SyntheticEvidenceBundleManifest,
} from "@veylta/contracts";
import { createSyntheticEvidenceBundle } from "./evidence-bundle.js";
import { EvidenceBundleVerificationError } from "./evidence-bundle-field-parsers.js";
import {
  verifySyntheticEvidenceBundle,
  verifySyntheticProfileArchive,
} from "./evidence-bundle-verifier.js";

function syntheticProfile(): SyntheticEvidenceBundleManifest["profile"] {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    familyId: "00000000-0000-4000-8000-000000000002",
    displayName: "Synthetic profile",
    kind: "adult",
    createdAt: "2026-08-12T00:00:00.000Z",
  };
}

function bundleFor(
  contentType: SyntheticDocumentContentType,
  source: Buffer,
  extension: "pdf" | "png" | "jpg",
): Buffer {
  const documentId = "00000000-0000-4000-8000-000000000003";
  return createSyntheticEvidenceBundle({
    manifest: {
      contractVersion: "synthetic-evidence-bundle/v1",
      exportedAt: "2026-08-12T00:00:00.000Z",
      profile: syntheticProfile(),
      documents: [
        {
          id: documentId,
          versionId: "00000000-0000-4000-8000-000000000004",
          originalFilename: "source.pdf",
          contentType,
          byteSize: source.byteLength,
          sha256: createHash("sha256").update(source).digest("hex"),
          uploadedAt: "2026-08-12T00:00:00.000Z",
          archivePath: `documents/${documentId}.${extension}`,
        },
      ],
      observations: [],
    },
    sources: [{ path: `documents/${documentId}.${extension}`, bytes: source }],
  });
}

function bundle(): Buffer {
  return bundleFor("application/pdf", Buffer.from("%PDF-synthetic-source", "utf8"), "pdf");
}

function rewriteHeaderChecksum(header: Buffer): void {
  header.fill(0x20, 148, 156);
  const checksum = header.reduce((total, value) => total + value, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `, "ascii").copy(header, 148);
}

test("verifies a safe local evidence bundle without extracting it", () => {
  assert.deepEqual(verifySyntheticEvidenceBundle(bundle()), {
    contractVersion: "synthetic-evidence-bundle/v1",
    documentCount: 1,
    observationCount: 0,
  });
});

test("verifies a complete synthetic profile archive only through its dedicated contract", () => {
  const archive = createSyntheticEvidenceBundle({
    manifest: {
      contractVersion: "synthetic-profile-export/v1",
      exportedAt: "2026-08-13T00:00:00.000Z",
      profile: syntheticProfile(),
      documents: [],
      observations: [],
    },
    sources: [],
  });
  assert.deepEqual(verifySyntheticProfileArchive(archive), {
    contractVersion: "synthetic-profile-export/v1",
    documentCount: 0,
    observationCount: 0,
  });
  assert.throws(
    () => verifySyntheticEvidenceBundle(archive),
    (error: unknown) => error instanceof EvidenceBundleVerificationError,
  );
});

test("verifies a source-first confirmed observation bound to an archived document", () => {
  const source = Buffer.from("%PDF-synthetic-source", "utf8");
  const documentId = "00000000-0000-4000-8000-000000000003";
  const versionId = "00000000-0000-4000-8000-000000000004";
  const archivePath = `documents/${documentId}.pdf`;
  const bundleWithObservation = createSyntheticEvidenceBundle({
    manifest: {
      contractVersion: "synthetic-evidence-bundle/v1",
      exportedAt: "2026-08-12T00:00:00.000Z",
      profile: syntheticProfile(),
      documents: [
        {
          id: documentId,
          versionId,
          originalFilename: "source.pdf",
          contentType: "application/pdf",
          byteSize: source.byteLength,
          sha256: createHash("sha256").update(source).digest("hex"),
          uploadedAt: "2026-08-12T00:00:00.000Z",
          archivePath,
        },
      ],
      observations: [
        {
          id: "00000000-0000-4000-8000-000000000005",
          canonicalCode: "synthetic-analyte-a",
          source: { name: "SYNTHETIC ANALYTE A", value: "7.0", unit: "synthetic-unit" },
          normalized: { value: null, unit: null, conversionVersion: null },
          referenceRange: {
            sourceText: "synthetic reference",
            sourceLow: null,
            sourceHigh: null,
            sourceUnit: "synthetic-unit",
            laboratoryOutOfRange: null,
            normalizedLow: null,
            normalizedHigh: null,
            normalizedUnit: null,
            conversionVersion: null,
          },
          dates: {
            sampledAt: null,
            resultedAt: null,
            uploadedAt: "2026-08-12T00:00:00.000Z",
          },
          timelineAt: "2026-08-12T00:00:00.000Z",
          specimenType: null,
          laboratory: null,
          extractionConfidence: 0.6,
          confirmed: {
            at: "2026-08-12T00:01:00.000Z",
            by: {
              id: "00000000-0000-4000-8000-000000000006",
              displayName: "Synthetic reviewer",
            },
          },
          sourceDocument: {
            id: documentId,
            versionId,
            pageNumber: 1,
            fragment: "synthetic source fragment",
            archivePath,
          },
        },
      ],
    },
    sources: [{ path: archivePath, bytes: source }],
  });

  assert.deepEqual(verifySyntheticEvidenceBundle(bundleWithObservation), {
    contractVersion: "synthetic-evidence-bundle/v1",
    documentCount: 1,
    observationCount: 1,
  });
});

test("verifies the supported direct PNG and JPEG source signatures", () => {
  for (const [contentType, source, extension] of [
    ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]), "png"],
    ["image/jpeg", Buffer.from([255, 216, 255, 0]), "jpg"],
  ] as const) {
    assert.deepEqual(verifySyntheticEvidenceBundle(bundleFor(contentType, source, extension)), {
      contractVersion: "synthetic-evidence-bundle/v1",
      documentCount: 1,
      observationCount: 0,
    });
  }
});

test("fails closed when an archived source byte changes after manifest creation", () => {
  const tampered = Buffer.from(bundle());
  const sourceOffset = tampered.indexOf("%PDF-synthetic-source");
  assert.notEqual(sourceOffset, -1);
  tampered[sourceOffset] = "%".charCodeAt(0) ^ 1;

  assert.throws(
    () => verifySyntheticEvidenceBundle(tampered),
    (error: unknown) => error instanceof EvidenceBundleVerificationError,
  );
});

test("fails closed for an archive with a traversal entry", () => {
  const malicious = Buffer.from(bundle());
  Buffer.from("../source.pdf\0", "utf8").copy(malicious, 512);
  malicious.fill(0, 512 + "../source.pdf\0".length, 512 + 100);
  rewriteHeaderChecksum(malicious.subarray(512, 1024));

  assert.throws(
    () => verifySyntheticEvidenceBundle(malicious),
    (error: unknown) => error instanceof EvidenceBundleVerificationError,
  );
});

test("fails closed for a valid-looking tar header carrying an unsupported link field", () => {
  const malicious = Buffer.from(bundle());
  malicious[512 + 157] = 1;
  rewriteHeaderChecksum(malicious.subarray(512, 1024));

  assert.throws(
    () => verifySyntheticEvidenceBundle(malicious),
    (error: unknown) => error instanceof EvidenceBundleVerificationError,
  );
});

test("fails closed for a tar entry with non-zero padding", () => {
  const malicious = Buffer.from(bundle());
  const sourceOffset = malicious.indexOf("%PDF-synthetic-source");
  assert.notEqual(sourceOffset, -1);
  malicious[sourceOffset + "%PDF-synthetic-source".length] = 1;

  assert.throws(
    () => verifySyntheticEvidenceBundle(malicious),
    (error: unknown) => error instanceof EvidenceBundleVerificationError,
  );
});

test("fails closed when a manifest carries fields outside the v1 shape", () => {
  const source = Buffer.from("%PDF-synthetic-source", "utf8");
  const documentId = "00000000-0000-4000-8000-000000000003";
  const manifest = {
    contractVersion: "synthetic-evidence-bundle/v1" as const,
    exportedAt: "2026-08-12T00:00:00.000Z",
    profile: {
      id: "00000000-0000-4000-8000-000000000001",
      familyId: "00000000-0000-4000-8000-000000000002",
      displayName: "Synthetic profile",
      kind: "adult" as const,
      createdAt: "2026-08-12T00:00:00.000Z",
    },
    documents: [
      {
        id: documentId,
        versionId: "00000000-0000-4000-8000-000000000004",
        originalFilename: "source.pdf",
        contentType: "application/pdf" as const,
        byteSize: source.byteLength,
        sha256: createHash("sha256").update(source).digest("hex"),
        uploadedAt: "2026-08-12T00:00:00.000Z",
        archivePath: `documents/${documentId}.pdf`,
      },
    ],
    observations: [],
    unexpected: true,
  } as unknown as SyntheticEvidenceBundleManifest;

  assert.throws(
    () =>
      verifySyntheticEvidenceBundle(
        createSyntheticEvidenceBundle({
          manifest,
          sources: [{ path: `documents/${documentId}.pdf`, bytes: source }],
        }),
      ),
    (error: unknown) => error instanceof EvidenceBundleVerificationError,
  );
});
