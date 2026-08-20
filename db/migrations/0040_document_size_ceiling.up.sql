-- The household may keep documents up to MAX_SYNTHETIC_DOCUMENT_BYTES (100 MB), but the byte
-- counts recorded at upload still carried the original 5 MB bound, so every larger source died
-- on a CHECK inside the accept transaction — a 500, not the 413 a size deserves.
--
-- SQLite cannot widen a CHECK in place, so the three tables that record how large a source was
-- are rebuilt the way the SQLite manual prescribes for schema changes ALTER TABLE cannot express:
-- each is recreated under a temporary name from the live DDL of 0039 (only the bound differs),
-- refilled row for row, dropped, and slid back under its own name; the reuse table's index and
-- immutability triggers are recreated after it. Nothing that references these tables moves —
-- document_versions, the two content-type overlays and everything below them keep their rows and
-- their foreign keys. Dropping a parent that still has children is only possible because the
-- runner clears enforcement around every migration and gates the commit on PRAGMA
-- foreign_key_check instead (apps/api/src/database/pool.ts, `schemaChange`).

CREATE TABLE document_blobs_0040 (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  storage_contract_version TEXT NOT NULL CHECK (
    storage_contract_version = 'object-storage/v1'
  ),
  storage_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type = 'application/pdf'),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 5 AND 104857600),
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, sha256),
  CONSTRAINT document_blobs_storage_key_check CHECK (
    instr('/' || storage_key || '/', '/../') = 0
    AND storage_key = trim(storage_key)
    AND length(storage_key) BETWEEN 1 AND 500
  )
);
INSERT INTO document_blobs_0040 SELECT * FROM document_blobs;

CREATE TABLE document_upload_requests_0040 (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL,
  patient_profile_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (
    length(idempotency_key_hash) = 64
    AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*'
  ),
  request_sha256 TEXT NOT NULL CHECK (
    length(request_sha256) = 64
    AND request_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  request_content_type TEXT NOT NULL CHECK (request_content_type = 'application/pdf'),
  request_byte_size INTEGER NOT NULL CHECK (request_byte_size BETWEEN 5 AND 104857600),
  document_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, actor_user_id, idempotency_key_hash),
  UNIQUE (family_id, document_id),
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, patient_profile_id)
    REFERENCES patient_profiles(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, patient_profile_id, document_id)
    REFERENCES documents(family_id, patient_profile_id, id)
    ON DELETE RESTRICT
);
INSERT INTO document_upload_requests_0040 SELECT * FROM document_upload_requests;

CREATE TABLE document_upload_reuse_requests_0040 (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL,
  patient_profile_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (
    length(idempotency_key_hash) = 64
    AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*'
  ),
  request_sha256 TEXT NOT NULL CHECK (
    length(request_sha256) = 64
    AND request_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  request_content_type TEXT NOT NULL CHECK (
    request_content_type IN ('application/pdf', 'image/png', 'image/jpeg')
  ),
  request_byte_size INTEGER NOT NULL CHECK (request_byte_size BETWEEN 5 AND 104857600),
  document_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, actor_user_id, idempotency_key_hash),
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, patient_profile_id, document_id)
    REFERENCES documents(family_id, patient_profile_id, id)
    ON DELETE RESTRICT
);
INSERT INTO document_upload_reuse_requests_0040 SELECT * FROM document_upload_reuse_requests;

-- The old tables go with their indexes and triggers; the reuse table's are recreated below.
DROP TABLE document_upload_reuse_requests;
DROP TABLE document_upload_requests;
DROP TABLE document_blobs;

ALTER TABLE document_blobs_0040 RENAME TO document_blobs;
ALTER TABLE document_upload_requests_0040 RENAME TO document_upload_requests;
ALTER TABLE document_upload_reuse_requests_0040 RENAME TO document_upload_reuse_requests;

CREATE INDEX document_upload_reuse_requests_document
  ON document_upload_reuse_requests (family_id, document_id, created_at DESC);

CREATE TRIGGER document_upload_reuse_requests_update_forbidden
BEFORE UPDATE ON document_upload_reuse_requests
BEGIN
  SELECT RAISE(ABORT, 'document upload reuse requests are immutable');
END;

CREATE TRIGGER document_upload_reuse_requests_delete_forbidden
BEFORE DELETE ON document_upload_reuse_requests
BEGIN
  SELECT RAISE(ABORT, 'document upload reuse requests are immutable');
END;
