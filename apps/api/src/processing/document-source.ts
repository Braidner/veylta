import { createHash } from "node:crypto";
import {
  MAX_SYNTHETIC_DOCUMENT_BYTES,
  OBJECT_STORAGE_CONTRACT_VERSION,
  type SyntheticDocumentContentType,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import {
  createObjectStorageKey,
  type ObjectStorage,
  ObjectStorageValidationError,
} from "../storage/object-storage.js";
import type { LeasedProcessingJob } from "./processing-job-service.js";

// The one way a run reaches its document's bytes: the immutable row that describes the source,
// then exactly those bytes, re-hashed while they stream. Nothing here trusts a filename.

interface DocumentSourceRow {
  storage_key: string;
  content_type: string;
  byte_size: number;
  sha256: string;
}

export interface DocumentSource {
  storageKey: ReturnType<typeof createObjectStorageKey>;
  contentType: SyntheticDocumentContentType;
  byteSize: number;
  sha256: string;
}

export class DocumentSourceUnavailableError extends Error {}

export async function sourceForClaim(
  database: DatabaseClient,
  claim: LeasedProcessingJob,
): Promise<DocumentSource> {
  const result = await database.query<DocumentSourceRow>(
    `SELECT b.storage_key, COALESCE(bt.content_type, b.content_type) AS content_type,
            b.byte_size, b.sha256
       FROM document_versions AS v
       JOIN documents AS d
         ON d.family_id = v.family_id
        AND d.id = v.document_id
       JOIN patient_profiles AS p
         ON p.family_id = d.family_id
        AND p.id = d.patient_profile_id
        AND p.archived_at IS NULL
       JOIN document_blobs AS b
         ON b.family_id = v.family_id
        AND b.id = v.blob_id
       LEFT JOIN document_blob_content_types AS bt
         ON bt.family_id = b.family_id
        AND bt.blob_id = b.id
      WHERE v.family_id = $1 AND v.id = $2
        AND d.deleted_at IS NULL`,
    [claim.familyId, claim.documentVersionId],
  );
  const row = result.rows[0];
  const byteSize = Number(row?.byte_size);
  if (
    result.rowCount !== 1 ||
    row === undefined ||
    !["application/pdf", "image/png", "image/jpeg"].includes(row.content_type) ||
    !Number.isSafeInteger(byteSize) ||
    byteSize < 5 ||
    byteSize > MAX_SYNTHETIC_DOCUMENT_BYTES ||
    !/^[a-f0-9]{64}$/.test(row.sha256)
  ) {
    throw new DocumentSourceUnavailableError();
  }
  try {
    return {
      storageKey: createObjectStorageKey(row.storage_key),
      contentType: row.content_type as SyntheticDocumentContentType,
      byteSize,
      sha256: row.sha256,
    };
  } catch (error) {
    if (error instanceof ObjectStorageValidationError) throw new DocumentSourceUnavailableError();
    throw error;
  }
}

async function exactBodyBytes(
  body: NodeJS.ReadableStream & AsyncIterable<unknown>,
  source: DocumentSource,
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  const digest = createHash("sha256");
  for await (const chunk of body) {
    const bytes =
      typeof chunk === "string"
        ? Buffer.from(chunk)
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as Uint8Array);
    byteSize += bytes.byteLength;
    if (byteSize > source.byteSize || byteSize > MAX_SYNTHETIC_DOCUMENT_BYTES) {
      throw new DocumentSourceUnavailableError();
    }
    digest.update(bytes);
    chunks.push(bytes);
  }
  if (byteSize !== source.byteSize || digest.digest("hex") !== source.sha256) {
    throw new DocumentSourceUnavailableError();
  }
  return Buffer.concat(chunks, byteSize);
}

export async function loadDocumentBytes(
  storage: ObjectStorage,
  source: DocumentSource,
): Promise<Uint8Array> {
  const read = await storage.get(source.storageKey, {
    contentType: source.contentType,
    byteSize: source.byteSize,
    sha256: source.sha256,
  });
  if (
    read.metadata.contractVersion !== OBJECT_STORAGE_CONTRACT_VERSION ||
    read.metadata.key !== source.storageKey ||
    read.metadata.contentType !== source.contentType ||
    read.metadata.byteSize !== source.byteSize ||
    read.metadata.sha256 !== source.sha256
  ) {
    read.body.destroy();
    throw new DocumentSourceUnavailableError();
  }
  return exactBodyBytes(read.body, source);
}
