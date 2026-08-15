ALTER TABLE documents ADD COLUMN deleted_at TEXT;
ALTER TABLE documents ADD COLUMN deleted_by_user_id TEXT;

CREATE INDEX documents_active_profile_time
  ON documents (family_id, patient_profile_id, uploaded_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER documents_delete_metadata_consistent
BEFORE UPDATE OF deleted_at, deleted_by_user_id ON documents
WHEN OLD.deleted_at IS NOT NULL
  OR OLD.deleted_by_user_id IS NOT NULL
  OR NEW.deleted_at IS NULL
  OR NEW.deleted_by_user_id IS NULL
  OR length(NEW.deleted_at) <> 24
  OR substr(NEW.deleted_at, 5, 1) <> '-'
  OR substr(NEW.deleted_at, 8, 1) <> '-'
  OR substr(NEW.deleted_at, 11, 1) <> 'T'
  OR substr(NEW.deleted_at, 24, 1) <> 'Z'
  OR NOT EXISTS (
    SELECT 1
      FROM family_memberships membership
     WHERE membership.family_id = NEW.family_id
       AND membership.user_id = NEW.deleted_by_user_id
       AND membership.status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'document deletion metadata is invalid or immutable');
END;

CREATE TRIGGER documents_hard_delete_forbidden
BEFORE DELETE ON documents
BEGIN
  SELECT RAISE(ABORT, 'documents must be tombstoned');
END;

CREATE TABLE document_upload_reuse_requests (
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

CREATE TABLE document_delete_requests (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL,
  patient_profile_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (
    length(idempotency_key_hash) = 64
    AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*'
  ),
  deleted_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  UNIQUE (family_id, actor_user_id, idempotency_key_hash),
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, patient_profile_id, document_id)
    REFERENCES documents(family_id, patient_profile_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_delete_requests_timestamp_check CHECK (
    length(deleted_at) = 24
    AND substr(deleted_at, 5, 1) = '-'
    AND substr(deleted_at, 8, 1) = '-'
    AND substr(deleted_at, 11, 1) = 'T'
    AND substr(deleted_at, 24, 1) = 'Z'
  )
);

CREATE INDEX document_delete_requests_document
  ON document_delete_requests (family_id, document_id, deleted_at DESC);

CREATE TRIGGER document_delete_requests_matches_tombstone
BEFORE INSERT ON document_delete_requests
WHEN NOT EXISTS (
  SELECT 1
    FROM documents document
   WHERE document.family_id = NEW.family_id
     AND document.patient_profile_id = NEW.patient_profile_id
     AND document.id = NEW.document_id
     AND document.deleted_at = NEW.deleted_at
     AND document.deleted_by_user_id = NEW.actor_user_id
)
BEGIN
  SELECT RAISE(ABORT, 'document delete request must reference its tombstone');
END;

CREATE TRIGGER document_delete_requests_update_forbidden
BEFORE UPDATE ON document_delete_requests
BEGIN
  SELECT RAISE(ABORT, 'document delete requests are immutable');
END;

CREATE TRIGGER document_delete_requests_delete_forbidden
BEFORE DELETE ON document_delete_requests
BEGIN
  SELECT RAISE(ABORT, 'document delete requests are immutable');
END;
