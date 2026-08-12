import { createHash } from "node:crypto";
import {
  SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION,
  type SyntheticEvidenceBundleManifest,
} from "@veylta/contracts";
import { ObjectStorageIntegrityError } from "../storage/object-storage.js";

export interface EvidenceBundleSource {
  path: string;
  bytes: Buffer;
}

export interface EvidenceBundleInput {
  manifest: SyntheticEvidenceBundleManifest;
  sources: readonly EvidenceBundleSource[];
}

const blockSize = 512;
const archivePathPattern = /^documents\/[0-9a-f-]{36}\.(?:pdf|png|jpg)$/;

function octal(value: number, width: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 8 ** (width - 1)) {
    throw new ObjectStorageIntegrityError("Evidence bundle tar field is invalid");
  }
  return Buffer.from(`${value.toString(8).padStart(width - 1, "0")}\0`, "ascii");
}

function tarHeader(path: string, size: number): Buffer {
  if (path.length === 0 || path.length > 100 || /[\0\r\n]/.test(path)) {
    throw new ObjectStorageIntegrityError("Evidence bundle archive path is invalid");
  }
  const header = Buffer.alloc(blockSize);
  header.write(path, 0, "utf8");
  octal(0o600, 8).copy(header, 100);
  octal(0, 8).copy(header, 108);
  octal(0, 8).copy(header, 116);
  octal(size, 12).copy(header, 124);
  octal(0, 12).copy(header, 136);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  const checksum = header.reduce((total, value) => total + value, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `, "ascii").copy(header, 148);
  return header;
}

function tarEntry(path: string, bytes: Buffer): Buffer {
  const padding = (blockSize - (bytes.byteLength % blockSize)) % blockSize;
  return Buffer.concat([tarHeader(path, bytes.byteLength), bytes, Buffer.alloc(padding)]);
}

function validate(input: EvidenceBundleInput): void {
  if (input.manifest.contractVersion !== SYNTHETIC_EVIDENCE_BUNDLE_CONTRACT_VERSION) {
    throw new ObjectStorageIntegrityError("Evidence bundle manifest version is invalid");
  }
  const expected = new Map(
    input.manifest.documents.map((document) => [document.archivePath, document]),
  );
  if (expected.size !== input.manifest.documents.length || input.sources.length !== expected.size) {
    throw new ObjectStorageIntegrityError("Evidence bundle source set is invalid");
  }
  for (const source of input.sources) {
    const document = expected.get(source.path);
    if (document === undefined || !archivePathPattern.test(source.path)) {
      throw new ObjectStorageIntegrityError("Evidence bundle source path is invalid");
    }
    if (
      source.bytes.byteLength !== document.byteSize ||
      createHash("sha256").update(source.bytes).digest("hex") !== document.sha256
    ) {
      throw new ObjectStorageIntegrityError(
        "Evidence bundle source does not match immutable metadata",
      );
    }
  }
}

/**
 * Builds a small, safe USTAR archive. Source paths are trusted,
 * generated selectors; original filenames stay only in the authorized manifest.
 */
export function createSyntheticEvidenceBundle(input: EvidenceBundleInput): Buffer {
  validate(input);
  const manifest = Buffer.from(`${JSON.stringify(input.manifest, null, 2)}\n`, "utf8");
  const sources = [...input.sources].sort((left, right) => left.path.localeCompare(right.path));
  return Buffer.concat([
    tarEntry("manifest.json", manifest),
    ...sources.map((source) => tarEntry(source.path, source.bytes)),
    Buffer.alloc(blockSize * 2),
  ]);
}
