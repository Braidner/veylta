-- The exact inverse of the up migration: the same three tables rebuilt back to the 5 MB bound.
--
-- Narrowing it would make a larger recorded source unrepresentable, and a source is never dropped
-- to make a rollback succeed. No guard states that separately — the rebuilt table's own CHECK is
-- the guard: copying a row that exceeds the old bound fails on it, and the runner rolls the whole
-- migration back, leaving the wide bound and every recorded byte count in place.

CREATE TABLE document_blobs_0039 (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  storage_contract_version TEXT NOT NULL CHECK (
    storage_contract_version = 'object-storage/v1'
  ),
  storage_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type = 'application/pdf'),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 5 AND 5242880),
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
INSERT INTO document_blobs_0039 SELECT * FROM document_blobs;

CREATE TABLE document_upload_requests_0039 (
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
  request_byte_size INTEGER NOT NULL CHECK (request_byte_size BETWEEN 5 AND 5242880),
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
INSERT INTO document_upload_requests_0039 SELECT * FROM document_upload_requests;

CREATE TABLE document_upload_reuse_requests_0039 (
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
  request_byte_size INTEGER NOT NULL CHECK (request_byte_size BETWEEN 5 AND 5242880),
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
INSERT INTO document_upload_reuse_requests_0039 SELECT * FROM document_upload_reuse_requests;

DROP TABLE document_upload_reuse_requests;
DROP TABLE document_upload_requests;
DROP TABLE document_blobs;

ALTER TABLE document_blobs_0039 RENAME TO document_blobs;
ALTER TABLE document_upload_requests_0039 RENAME TO document_upload_requests;
ALTER TABLE document_upload_reuse_requests_0039 RENAME TO document_upload_reuse_requests;

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
