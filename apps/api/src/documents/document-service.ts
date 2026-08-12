import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  DOCUMENT_CONTRACT_VERSION,
  type DocumentSummary,
  OBJECT_STORAGE_CONTRACT_VERSION,
} from "@family-health/contracts";
import type { Database, QueryResult } from "../database/pool.js";
import { ResourceNotFoundError, type SessionActor } from "../family/family-service.js";
import {
  createObjectStorageKey,
  type ObjectMetadata,
  type ObjectStorage,
  ObjectStorageIntegrityError,
  type ObjectStorageKey,
  ObjectStorageSizeLimitError,
  type StagedObjectMetadata,
} from "../storage/object-storage.js";

export class UnsupportedDocumentTypeError extends Error {}
export class InvalidPdfSignatureError extends Error {}
export class UploadTooLargeError extends Error {}
export class IdempotencyConflictError extends Error {}

export interface StagedDocument {
  metadata: StagedObjectMetadata;
  originalFilename: string;
}

export interface DocumentContent {
  body: Readable;
  byteSize: number;
}

export interface DocumentService {
  acceptUpload(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
    staged: StagedDocument,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<DocumentSummary>;
  discardStaged(staged: StagedDocument): Promise<void>;
  getContent(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    correlationId: string,
  ): Promise<DocumentContent>;
  getDocument(
    actor: SessionActor,
    scope: { familyId: string; profileId: string; documentId: string },
    correlationId: string,
  ): Promise<DocumentSummary>;
  requireProfileAccess(
    actor: SessionActor,
    scope: { familyId: string; profileId: string },
  ): Promise<void>;
  stagePdf(input: {
    body: Readable;
    contentType: string;
    filename: string | undefined;
  }): Promise<StagedDocument>;
}

export interface DocumentServiceOptions {
  maxPdfBytes: number;
}

interface Queryable {
  query<T extends object>(queryText: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface DocumentRow {
  id: string;
  family_id: string;
  patient_profile_id: string;
  status: "uploaded";
  original_filename: string;
  uploaded_at: string;
  duplicate_of_document_id: string | null;
  duplicate_profile_id: string | null;
  content_type: "application/pdf";
  byte_size: number;
  sha256: string;
  storage_key: string;
}

interface UploadRequestRow {
  document_id: string;
  patient_profile_id: string;
  request_byte_size: number;
  request_content_type: string;
  request_sha256: string;
}

interface BlobRow {
  id: string;
  storage_key: string;
  content_type: "application/pdf";
  byte_size: number;
  sha256: string;
}

const pdfSignature = Buffer.from("%PDF-");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function finalObjectKey(familyId: string, checksum: string): ObjectStorageKey {
  return createObjectStorageKey(`family_${familyId}/sha256_${checksum}`);
}

function stagingObjectKey(): ObjectStorageKey {
  return createObjectStorageKey(`staging/upload_${randomUUID()}`);
}

function canonicalProfileScope(scope: { familyId: string; profileId: string }) {
  return {
    familyId: scope.familyId.toLowerCase(),
    profileId: scope.profileId.toLowerCase(),
  };
}

function canonicalDocumentScope(scope: {
  familyId: string;
  profileId: string;
  documentId: string;
}) {
  return {
    ...canonicalProfileScope(scope),
    documentId: scope.documentId.toLowerCase(),
  };
}

function safeFilename(value: string | undefined): string {
  const leaf = (value ?? "").split(/[\\/]/).at(-1) ?? "";
  const cleaned = [...leaf]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  const bounded = [...cleaned].slice(0, 255).join("");
  return bounded.length === 0 ? "document.pdf" : bounded;
}

function byteSize(value: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ObjectStorageIntegrityError("Database object size is invalid");
  }
  return parsed;
}

function summary(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    familyId: row.family_id,
    profileId: row.patient_profile_id,
    status: row.status,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    byteSize: byteSize(row.byte_size),
    sha256: row.sha256,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    duplicate: {
      possible: row.duplicate_of_document_id !== null,
      documentId: row.duplicate_of_document_id,
      profileId: row.duplicate_profile_id,
    },
    processing: { state: "not_started" },
  };
}

function metadataMatches(
  metadata: ObjectMetadata,
  expected: Pick<StagedObjectMetadata, "byteSize" | "contentType" | "sha256">,
): boolean {
  return (
    metadata.contractVersion === OBJECT_STORAGE_CONTRACT_VERSION &&
    metadata.contentType === expected.contentType &&
    metadata.byteSize === expected.byteSize &&
    metadata.sha256 === expected.sha256
  );
}

async function* verifiedPdfBytes(body: Readable): AsyncGenerator<Buffer> {
  let prefix = Buffer.alloc(0);
  let verified = false;
  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (verified) {
      yield bytes;
      continue;
    }
    const needed = pdfSignature.byteLength - prefix.byteLength;
    prefix = Buffer.concat([prefix, bytes.subarray(0, needed)]);
    if (prefix.byteLength < pdfSignature.byteLength) continue;
    if (!prefix.equals(pdfSignature)) throw new InvalidPdfSignatureError();
    verified = true;
    yield prefix;
    const remainder = bytes.subarray(needed);
    if (remainder.byteLength > 0) yield remainder;
  }
  if (!verified) throw new InvalidPdfSignatureError();
}

async function requireProfileAccess(
  client: Queryable,
  actor: SessionActor,
  familyId: string,
  profileId: string,
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `SELECT p.id
     FROM patient_profiles p
     JOIN family_memberships m
       ON m.family_id = p.family_id
      AND m.user_id = $3
     WHERE p.family_id = $1
       AND p.id = $2
       AND p.archived_at IS NULL
       AND m.status = 'active'
       AND m.role = 'owner'`,
    [familyId, profileId, actor.userId],
  );
  if (result.rows[0] === undefined) throw new ResourceNotFoundError();
}

async function audit(
  client: Queryable,
  event: {
    familyId: string;
    actorUserId: string;
    action: string;
    resourceId: string;
    correlationId: string;
    createdAt: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, resource_type, resource_id, result,
        correlation_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, 'Document', $5, 'success', $6, $7, $8)`,
    [
      randomUUID(),
      event.familyId,
      event.actorUserId,
      event.action,
      event.resourceId,
      event.correlationId,
      { contractVersion: DOCUMENT_CONTRACT_VERSION },
      event.createdAt,
    ],
  );
}

async function documentRow(
  client: Queryable,
  actor: SessionActor,
  scope: { familyId: string; profileId: string; documentId: string },
): Promise<DocumentRow> {
  const result = await client.query<DocumentRow>(
    `SELECT d.id,
            d.family_id,
            d.patient_profile_id,
            d.status,
            d.original_filename,
            d.uploaded_at,
            d.duplicate_of_document_id,
            duplicate.patient_profile_id AS duplicate_profile_id,
            b.content_type,
            b.byte_size,
            b.sha256,
            b.storage_key
     FROM documents d
     JOIN family_memberships m
       ON m.family_id = d.family_id
      AND m.user_id = $4
      AND m.status = 'active'
      AND m.role = 'owner'
     JOIN document_versions v
       ON v.family_id = d.family_id
      AND v.document_id = d.id
      AND v.version_number = 1
     JOIN document_blobs b
       ON b.family_id = v.family_id
      AND b.id = v.blob_id
     LEFT JOIN documents duplicate
       ON duplicate.family_id = d.family_id
      AND duplicate.id = d.duplicate_of_document_id
     WHERE d.family_id = $1
       AND d.patient_profile_id = $2
       AND d.id = $3`,
    [scope.familyId, scope.profileId, scope.documentId, actor.userId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new ResourceNotFoundError();
  return row;
}

export function createDocumentService(
  database: Database,
  storage: ObjectStorage,
  options: DocumentServiceOptions,
): DocumentService {
  if (!Number.isSafeInteger(options.maxPdfBytes) || options.maxPdfBytes < pdfSignature.byteLength) {
    throw new Error("maxPdfBytes must fit a PDF signature");
  }

  return {
    async requireProfileAccess(actor, requestedScope) {
      const scope = canonicalProfileScope(requestedScope);
      await requireProfileAccess(database, actor, scope.familyId, scope.profileId);
    },

    async stagePdf(input) {
      if (input.contentType.toLowerCase() !== "application/pdf") {
        input.body.resume();
        throw new UnsupportedDocumentTypeError();
      }
      try {
        const metadata = await storage.putStaging({
          key: stagingObjectKey(),
          body: Readable.from(verifiedPdfBytes(input.body)),
          contentType: "application/pdf",
          maxBytes: options.maxPdfBytes,
        });
        return { metadata, originalFilename: safeFilename(input.filename) };
      } catch (error) {
        if (error instanceof ObjectStorageSizeLimitError) throw new UploadTooLargeError();
        throw error;
      }
    },

    async discardStaged(staged) {
      await storage.deleteStaging(staged.metadata.key);
    },

    async acceptUpload(actor, requestedScope, staged, idempotencyKey, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const keyHash = sha256(idempotencyKey);
      try {
        return await database
          .transaction(async (client) => {
            await requireProfileAccess(client, actor, scope.familyId, scope.profileId);

            const replay = await client.query<UploadRequestRow>(
              `SELECT document_id,
                    patient_profile_id,
                    request_byte_size,
                    request_content_type,
                    request_sha256
             FROM document_upload_requests
             WHERE family_id = $1
               AND actor_user_id = $2
               AND idempotency_key_hash = $3`,
              [scope.familyId, actor.userId, keyHash],
            );
            const previous = replay.rows[0];
            if (previous !== undefined) {
              if (
                previous.patient_profile_id !== scope.profileId ||
                previous.request_sha256 !== staged.metadata.sha256 ||
                previous.request_content_type !== staged.metadata.contentType ||
                byteSize(previous.request_byte_size) !== staged.metadata.byteSize
              ) {
                throw new IdempotencyConflictError();
              }
              const replayed = await documentRow(client, actor, {
                ...scope,
                documentId: previous.document_id,
              });
              await audit(client, {
                familyId: scope.familyId,
                actorUserId: actor.userId,
                action: "document.upload.replayed",
                resourceId: replayed.id,
                correlationId,
                createdAt: new Date(),
              });
              return replayed;
            }

            const existingBlobs = await client.query<BlobRow>(
              `SELECT id, storage_key, content_type, byte_size, sha256
             FROM document_blobs
             WHERE family_id = $1 AND sha256 = $2`,
              [scope.familyId, staged.metadata.sha256],
            );
            let blob = existingBlobs.rows[0];
            if (blob === undefined) {
              const finalKey = finalObjectKey(scope.familyId, staged.metadata.sha256);
              const finalized = await storage.finalize(staged.metadata.key, finalKey);
              if (!metadataMatches(finalized.metadata, staged.metadata)) {
                throw new ObjectStorageIntegrityError(
                  "Final object metadata does not match the staged upload",
                );
              }
              blob = {
                id: randomUUID(),
                storage_key: finalKey,
                content_type: "application/pdf",
                byte_size: staged.metadata.byteSize,
                sha256: staged.metadata.sha256,
              };
              await client.query(
                `INSERT INTO document_blobs
                 (id, family_id, storage_contract_version, storage_key, content_type,
                  byte_size, sha256)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                  blob.id,
                  scope.familyId,
                  OBJECT_STORAGE_CONTRACT_VERSION,
                  blob.storage_key,
                  blob.content_type,
                  staged.metadata.byteSize,
                  blob.sha256,
                ],
              );
            } else {
              const metadata = await storage.stat(createObjectStorageKey(blob.storage_key));
              if (
                byteSize(blob.byte_size) !== staged.metadata.byteSize ||
                metadata === null ||
                !metadataMatches(metadata, staged.metadata)
              ) {
                throw new ObjectStorageIntegrityError(
                  "Persisted blob metadata does not match immutable storage",
                );
              }
            }

            const duplicate = await client.query<{
              id: string;
              patient_profile_id: string;
            }>(
              `SELECT d.id, d.patient_profile_id
             FROM document_versions v
             JOIN documents d
               ON d.family_id = v.family_id
              AND d.id = v.document_id
             WHERE v.family_id = $1 AND v.blob_id = $2
             ORDER BY d.uploaded_at, d.id
             LIMIT 1`,
              [scope.familyId, blob.id],
            );
            const duplicateRow = duplicate.rows[0];
            const now = new Date();
            const uploadedAt = now.toISOString();
            const documentId = randomUUID();
            await client.query(
              `INSERT INTO documents
               (id, family_id, patient_profile_id, status, original_filename,
                uploaded_by_user_id, uploaded_at, duplicate_of_document_id)
             VALUES ($1, $2, $3, 'uploaded', $4, $5, $6, $7)`,
              [
                documentId,
                scope.familyId,
                scope.profileId,
                staged.originalFilename,
                actor.userId,
                uploadedAt,
                duplicateRow?.id ?? null,
              ],
            );
            await client.query(
              `INSERT INTO document_versions
               (id, family_id, document_id, blob_id, version_number, created_at)
             VALUES ($1, $2, $3, $4, 1, $5)`,
              [randomUUID(), scope.familyId, documentId, blob.id, uploadedAt],
            );
            await client.query(
              `INSERT INTO document_upload_requests
               (id, family_id, actor_user_id, patient_profile_id, idempotency_key_hash,
                request_sha256, request_content_type, request_byte_size, document_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                randomUUID(),
                scope.familyId,
                actor.userId,
                scope.profileId,
                keyHash,
                staged.metadata.sha256,
                staged.metadata.contentType,
                staged.metadata.byteSize,
                documentId,
                uploadedAt,
              ],
            );
            await audit(client, {
              familyId: scope.familyId,
              actorUserId: actor.userId,
              action: "document.upload.received",
              resourceId: documentId,
              correlationId,
              createdAt: now,
            });
            return {
              id: documentId,
              family_id: scope.familyId,
              patient_profile_id: scope.profileId,
              status: "uploaded",
              original_filename: staged.originalFilename,
              uploaded_at: uploadedAt,
              duplicate_of_document_id: duplicateRow?.id ?? null,
              duplicate_profile_id: duplicateRow?.patient_profile_id ?? null,
              content_type: blob.content_type,
              byte_size: blob.byte_size,
              sha256: blob.sha256,
              storage_key: blob.storage_key,
            } satisfies DocumentRow;
          })
          .then(summary);
      } finally {
        await storage.deleteStaging(staged.metadata.key).catch(() => undefined);
      }
    },

    async getDocument(actor, requestedScope, correlationId) {
      const scope = canonicalDocumentScope(requestedScope);
      return database.transaction(async (client) => {
        const row = await documentRow(client, actor, scope);
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.metadata.opened",
          resourceId: scope.documentId,
          correlationId,
          createdAt: new Date(),
        });
        return summary(row);
      });
    },

    async getContent(actor, requestedScope, correlationId) {
      const scope = canonicalDocumentScope(requestedScope);
      return database.transaction(async (client) => {
        const row = await documentRow(client, actor, scope);
        const key = createObjectStorageKey(row.storage_key);
        const expected = {
          contentType: row.content_type,
          byteSize: byteSize(row.byte_size),
          sha256: row.sha256,
        };
        const stored = await storage.get(key, expected);
        if (!metadataMatches(stored.metadata, expected)) {
          throw new ObjectStorageIntegrityError(
            "Document metadata does not match immutable storage",
          );
        }
        await audit(client, {
          familyId: scope.familyId,
          actorUserId: actor.userId,
          action: "document.content.opened",
          resourceId: scope.documentId,
          correlationId,
          createdAt: new Date(),
        });
        return { body: stored.body, byteSize: stored.metadata.byteSize };
      });
    },
  };
}
