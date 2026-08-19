import { createHash } from "node:crypto";
import {
  MAX_SYNTHETIC_DOCUMENT_BYTES,
  MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS,
  MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS,
  SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION,
  SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION,
} from "@veylta/contracts";
import {
  fail,
  hasExactKeys,
  isRecord,
  nullableBoundedString,
  nullableStoredText,
  nullableTimestamp,
  requiredBoundedString,
  requiredCanonicalUuid,
  requiredStoredText,
  requiredString,
  requiredTimestamp,
} from "./evidence-bundle-field-parsers.js";

const tarBlockBytes = 512;
const maximumManifestBytes = 8 * 1024 * 1024;
const maximumArchiveBytes =
  MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS * MAX_SYNTHETIC_DOCUMENT_BYTES +
  maximumManifestBytes +
  (MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS + 3) * tarBlockBytes +
  (MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS + 1) * (tarBlockBytes - 1);
const documentPathPattern =
  /^documents\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.(pdf|png|jpg)$/;
const checksumPattern = /^[a-f0-9]{64}$/;
const canonicalCodePattern = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const maximumObservationCount = MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS * 100;

export interface EvidenceBundleVerification {
  contractVersion:
    | typeof SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION
    | typeof SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION;
  documentCount: number;
  observationCount: number;
}

interface TarEntry {
  path: string;
  body: Buffer;
}

interface VerifiedDocument {
  id: string;
  versionId: string;
  contentType: "application/pdf" | "image/png" | "image/jpeg";
  byteSize: number;
  sha256: string;
  archivePath: string;
}

interface VerifiedManifest {
  contractVersion: EvidenceBundleVerification["contractVersion"];
  documents: Map<string, VerifiedDocument>;
  observationCount: number;
}

function tarChecksum(header: Buffer): number {
  const normalized = Buffer.from(header);
  normalized.fill(0x20, 148, 156);
  return normalized.reduce((total, value) => total + value, 0);
}

function allZero(header: Buffer, start: number, end: number): boolean {
  return header.subarray(start, end).every((byte) => byte === 0);
}

function octalField(header: Buffer, start: number, length: number): number {
  const raw = header.subarray(start, start + length).toString("ascii");
  if (!/^[0-7]+\0(?: {0,})$/.test(raw)) fail();
  const value = Number.parseInt(raw.slice(0, raw.indexOf("\0")), 8);
  if (!Number.isSafeInteger(value) || value < 0) fail();
  return value;
}

function headerPath(header: Buffer): string {
  const raw = header.subarray(0, 100);
  const nul = raw.indexOf(0);
  if (nul <= 0 || raw.subarray(nul + 1).some((byte) => byte !== 0)) fail();
  const path = raw.subarray(0, nul).toString("utf8");
  if (Buffer.from(path, "utf8").byteLength !== nul || /[\0\r\n]/.test(path)) fail();
  return path;
}

function parseTar(bundle: Buffer): Map<string, TarEntry> {
  if (
    bundle.byteLength < tarBlockBytes * 3 ||
    bundle.byteLength > maximumArchiveBytes ||
    bundle.byteLength % tarBlockBytes !== 0
  ) {
    fail();
  }
  const entries = new Map<string, TarEntry>();
  let offset = 0;
  while (offset < bundle.byteLength) {
    const header = bundle.subarray(offset, offset + tarBlockBytes);
    if (header.every((byte) => byte === 0)) {
      const end = bundle.subarray(offset);
      if (end.byteLength !== tarBlockBytes * 2 || !end.every((byte) => byte === 0)) fail();
      return entries;
    }
    if (
      header.subarray(257, 263).toString("ascii") !== "ustar\0" ||
      header.subarray(263, 265).toString("ascii") !== "00" ||
      octalField(header, 100, 8) !== 0o600 ||
      octalField(header, 108, 8) !== 0 ||
      octalField(header, 116, 8) !== 0 ||
      octalField(header, 136, 12) !== 0 ||
      header[156] !== "0".charCodeAt(0) ||
      !allZero(header, 157, 257) ||
      !allZero(header, 265, tarBlockBytes)
    ) {
      fail();
    }
    if (tarChecksum(header) !== octalField(header, 148, 8)) fail();
    const path = headerPath(header);
    const size = octalField(header, 124, 12);
    const bodyStart = offset + tarBlockBytes;
    const bodyEnd = bodyStart + size;
    const paddedEnd = bodyStart + Math.ceil(size / tarBlockBytes) * tarBlockBytes;
    if (
      bodyEnd > bundle.byteLength ||
      paddedEnd > bundle.byteLength ||
      entries.has(path) ||
      !bundle.subarray(bodyEnd, paddedEnd).every((byte) => byte === 0)
    ) {
      fail();
    }
    entries.set(path, { path, body: bundle.subarray(bodyStart, bodyEnd) });
    offset = paddedEnd;
  }
  fail();
}

function expectedExtension(contentType: VerifiedDocument["contentType"]): "pdf" | "png" | "jpg" {
  switch (contentType) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
  }
}

function verifyReferenceRange(value: unknown): void {
  if (value === null) return;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "conversionVersion",
      "laboratoryOutOfRange",
      "normalizedHigh",
      "normalizedLow",
      "normalizedUnit",
      "sourceHigh",
      "sourceLow",
      "sourceText",
      "sourceUnit",
    ])
  ) {
    fail();
  }
  const sourceText = nullableStoredText(value.sourceText, 1_000);
  const sourceLow = nullableBoundedString(value.sourceLow, 100);
  const sourceHigh = nullableBoundedString(value.sourceHigh, 100);
  const sourceUnit = nullableBoundedString(value.sourceUnit, 100);
  const laboratoryOutOfRange = value.laboratoryOutOfRange;
  if (laboratoryOutOfRange !== null && typeof laboratoryOutOfRange !== "boolean") {
    fail();
  }
  const normalizedLow = nullableBoundedString(value.normalizedLow, 100);
  const normalizedHigh = nullableBoundedString(value.normalizedHigh, 100);
  const normalizedUnit = nullableBoundedString(value.normalizedUnit, 100);
  const conversionVersion = nullableBoundedString(value.conversionVersion, 100);
  const sourceValues = [sourceText, sourceLow, sourceHigh, sourceUnit, laboratoryOutOfRange];
  const normalizedValues = [normalizedLow, normalizedHigh, normalizedUnit, conversionVersion];
  if (sourceValues.every((item) => item === null)) fail();
  if (
    !(
      normalizedValues.every((item) => item === null) ||
      ((normalizedLow !== null || normalizedHigh !== null) &&
        normalizedUnit !== null &&
        conversionVersion !== null)
    )
  ) {
    fail();
  }
}

function verifyObservation(value: unknown, documents: Map<string, VerifiedDocument>): void {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "canonicalCode",
      "confirmed",
      "dates",
      "extractionConfidence",
      "id",
      "laboratory",
      "normalized",
      "referenceRange",
      "source",
      "sourceDocument",
      "specimenType",
      "timelineAt",
    ])
  ) {
    fail();
  }
  requiredCanonicalUuid(value.id);
  const canonicalCode = nullableBoundedString(value.canonicalCode, 100);
  if (canonicalCode !== null && !canonicalCodePattern.test(canonicalCode)) fail();
  if (!isRecord(value.source) || !hasExactKeys(value.source, ["name", "unit", "value"])) fail();
  requiredBoundedString(value.source.name, 200);
  requiredBoundedString(value.source.value, 100);
  requiredBoundedString(value.source.unit, 100);
  if (
    !isRecord(value.normalized) ||
    !hasExactKeys(value.normalized, ["conversionVersion", "unit", "value"])
  ) {
    fail();
  }
  const normalizedValue = nullableBoundedString(value.normalized.value, 100);
  const normalizedUnit = nullableBoundedString(value.normalized.unit, 100);
  const conversionVersion = nullableBoundedString(value.normalized.conversionVersion, 100);
  if (
    !(
      [normalizedValue, normalizedUnit, conversionVersion].every((item) => item === null) ||
      [normalizedValue, normalizedUnit, conversionVersion].every((item) => item !== null)
    )
  ) {
    fail();
  }
  verifyReferenceRange(value.referenceRange);
  if (
    !isRecord(value.dates) ||
    !hasExactKeys(value.dates, ["resultedAt", "sampledAt", "uploadedAt"])
  ) {
    fail();
  }
  const sampledAt = nullableTimestamp(value.dates.sampledAt);
  const resultedAt = nullableTimestamp(value.dates.resultedAt);
  const uploadedAt = requiredTimestamp(value.dates.uploadedAt);
  if (requiredTimestamp(value.timelineAt) !== (sampledAt ?? resultedAt ?? uploadedAt)) fail();
  nullableBoundedString(value.specimenType, 200);
  nullableBoundedString(value.laboratory, 200);
  if (
    typeof value.extractionConfidence !== "number" ||
    !Number.isFinite(value.extractionConfidence) ||
    value.extractionConfidence < 0 ||
    value.extractionConfidence > 1
  ) {
    fail();
  }
  if (!isRecord(value.confirmed) || !hasExactKeys(value.confirmed, ["at", "by"])) fail();
  requiredTimestamp(value.confirmed.at);
  if (!isRecord(value.confirmed.by) || !hasExactKeys(value.confirmed.by, ["displayName", "id"]))
    fail();
  requiredCanonicalUuid(value.confirmed.by.id);
  requiredBoundedString(value.confirmed.by.displayName, 200);
  if (
    !isRecord(value.sourceDocument) ||
    !hasExactKeys(value.sourceDocument, [
      "archivePath",
      "fragment",
      "id",
      "pageNumber",
      "versionId",
    ])
  ) {
    fail();
  }
  const sourceDocument = value.sourceDocument;
  const document = documents.get(requiredString(sourceDocument.archivePath, 64));
  if (
    document === undefined ||
    requiredCanonicalUuid(sourceDocument.id) !== document.id ||
    requiredCanonicalUuid(sourceDocument.versionId) !== document.versionId ||
    typeof sourceDocument.pageNumber !== "number" ||
    !Number.isSafeInteger(sourceDocument.pageNumber) ||
    sourceDocument.pageNumber < 1
  ) {
    fail();
  }
  requiredStoredText(sourceDocument.fragment, 4_000);
}

function verifyManifest(bundle: Buffer): VerifiedManifest {
  if (bundle.byteLength === 0 || bundle.byteLength > maximumManifestBytes) fail();
  let parsed: unknown;
  try {
    parsed = JSON.parse(bundle.toString("utf8"));
  } catch {
    fail();
  }
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, [
      "contractVersion",
      "documents",
      "exportedAt",
      "observations",
      "profile",
    ]) ||
    (parsed.contractVersion !== SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION &&
      parsed.contractVersion !== SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION)
  ) {
    fail();
  }
  requiredTimestamp(parsed.exportedAt);
  if (
    !isRecord(parsed.profile) ||
    !hasExactKeys(parsed.profile, ["createdAt", "displayName", "familyId", "id", "kind"])
  ) {
    fail();
  }
  requiredCanonicalUuid(parsed.profile.id);
  requiredCanonicalUuid(parsed.profile.familyId);
  requiredString(parsed.profile.displayName, 120);
  if (parsed.profile.kind !== "adult" && parsed.profile.kind !== "dependent") fail();
  requiredTimestamp(parsed.profile.createdAt);
  if (
    !Array.isArray(parsed.documents) ||
    parsed.documents.length >
      (parsed.contractVersion === SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION
        ? MAX_SYNTHETIC_EVIDENCE_BUNDLE_DOCUMENTS
        : MAX_SYNTHETIC_PROFILE_EXPORT_DOCUMENTS) ||
    !Array.isArray(parsed.observations) ||
    parsed.observations.length > maximumObservationCount
  ) {
    fail();
  }
  const documents = new Map<string, VerifiedDocument>();
  for (const value of parsed.documents) {
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        "archivePath",
        "byteSize",
        "contentType",
        "id",
        "originalFilename",
        "sha256",
        "uploadedAt",
        "versionId",
      ])
    ) {
      fail();
    }
    const id = requiredCanonicalUuid(value.id);
    const versionId = requiredCanonicalUuid(value.versionId);
    requiredString(value.originalFilename, 255);
    const contentType = value.contentType;
    if (
      contentType !== "application/pdf" &&
      contentType !== "image/png" &&
      contentType !== "image/jpeg"
    ) {
      fail();
    }
    if (
      typeof value.byteSize !== "number" ||
      !Number.isSafeInteger(value.byteSize) ||
      value.byteSize <= 0 ||
      value.byteSize > MAX_SYNTHETIC_DOCUMENT_BYTES
    ) {
      fail();
    }
    const sha256 = requiredString(value.sha256, 64);
    if (!checksumPattern.test(sha256)) fail();
    requiredTimestamp(value.uploadedAt);
    const archivePath = requiredString(value.archivePath, 64);
    const match = documentPathPattern.exec(archivePath);
    if (
      match?.[1] !== id ||
      match[2] !== expectedExtension(contentType) ||
      documents.has(archivePath)
    ) {
      fail();
    }
    documents.set(archivePath, {
      id,
      versionId,
      contentType,
      byteSize: value.byteSize,
      sha256,
      archivePath,
    });
  }
  for (const value of parsed.observations) {
    verifyObservation(value, documents);
  }
  return {
    contractVersion: parsed.contractVersion,
    documents,
    observationCount: parsed.observations.length,
  };
}

function matchesSourceSignature(
  body: Buffer,
  contentType: VerifiedDocument["contentType"],
): boolean {
  if (contentType === "application/pdf") return body.subarray(0, 5).equals(Buffer.from("%PDF-"));
  if (contentType === "image/png") {
    return body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return body.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
}

/**
 * Verifies an in-memory local evidence TAR without extracting any entry to disk.
 * The verifier intentionally exposes counts only, never profile, filename, or
 * source values, so a caller can log a successful verification safely.
 */
function verifyArchive(
  bundle: Buffer,
  expectedContractVersion: EvidenceBundleVerification["contractVersion"],
): EvidenceBundleVerification {
  const entries = parseTar(bundle);
  const manifestEntry = entries.get("manifest.json");
  if (manifestEntry === undefined) fail();
  const manifest = verifyManifest(manifestEntry.body);
  if (manifest.contractVersion !== expectedContractVersion) fail();
  if (entries.size !== manifest.documents.size + 1) fail();
  for (const document of manifest.documents.values()) {
    const entry = entries.get(document.archivePath);
    if (
      entry === undefined ||
      entry.body.byteLength !== document.byteSize ||
      !matchesSourceSignature(entry.body, document.contentType) ||
      createHash("sha256").update(entry.body).digest("hex") !== document.sha256
    ) {
      fail();
    }
  }
  return {
    contractVersion: manifest.contractVersion,
    documentCount: manifest.documents.size,
    observationCount: manifest.observationCount,
  };
}

export function verifySyntheticEvidenceBundle(bundle: Buffer): EvidenceBundleVerification {
  return verifyArchive(bundle, SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION);
}

/** Validates the complete bounded local synthetic profile export without extraction. */
export function verifySyntheticProfileArchive(bundle: Buffer): EvidenceBundleVerification {
  return verifyArchive(bundle, SYNTHETIC_PROFILE_EXPORT_CONTRACT_VERSION);
}

export const MAX_SYNTHETIC_EVIDENCE_BUNDLE_ARCHIVE_BYTES = maximumArchiveBytes;
