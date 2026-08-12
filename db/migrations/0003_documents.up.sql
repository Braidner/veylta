CREATE TABLE document_blobs (
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

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  patient_profile_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'uploaded'),
  original_filename TEXT NOT NULL,
  uploaded_by_user_id TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  duplicate_of_document_id TEXT,
  UNIQUE (family_id, id),
  UNIQUE (family_id, patient_profile_id, id),
  FOREIGN KEY (family_id, patient_profile_id)
    REFERENCES patient_profiles(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, uploaded_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, duplicate_of_document_id)
    REFERENCES documents(family_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT documents_original_filename_check CHECK (
    length(original_filename) BETWEEN 1 AND 255
    AND original_filename = trim(original_filename)
  ),
  CONSTRAINT documents_not_self_duplicate_check CHECK (
    duplicate_of_document_id IS NULL OR duplicate_of_document_id <> id
  )
);

CREATE INDEX documents_profile_time
  ON documents (family_id, patient_profile_id, uploaded_at DESC);

CREATE TABLE document_versions (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  document_id TEXT NOT NULL,
  blob_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (document_id, version_number),
  FOREIGN KEY (family_id, document_id)
    REFERENCES documents(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, blob_id)
    REFERENCES document_blobs(family_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX document_versions_blob
  ON document_versions (family_id, blob_id);

CREATE TABLE document_upload_requests (
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
