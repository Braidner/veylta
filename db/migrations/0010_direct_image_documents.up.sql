CREATE TABLE document_blob_content_types (
  blob_id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  content_type TEXT NOT NULL CHECK (
    content_type IN ('application/pdf', 'image/png', 'image/jpeg')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, blob_id),
  FOREIGN KEY (family_id, blob_id)
    REFERENCES document_blobs(family_id, id)
    ON DELETE RESTRICT
);

CREATE TRIGGER document_blob_content_types_update_forbidden
BEFORE UPDATE ON document_blob_content_types
BEGIN
  SELECT RAISE(ABORT, 'document blob content type is immutable');
END;

CREATE TRIGGER document_blob_content_types_delete_forbidden
BEFORE DELETE ON document_blob_content_types
BEGIN
  SELECT RAISE(ABORT, 'document blob content type is immutable');
END;

CREATE TABLE document_upload_request_content_types (
  upload_request_id TEXT PRIMARY KEY REFERENCES document_upload_requests(id) ON DELETE RESTRICT,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  content_type TEXT NOT NULL CHECK (
    content_type IN ('application/pdf', 'image/png', 'image/jpeg')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER document_upload_request_content_types_update_forbidden
BEFORE UPDATE ON document_upload_request_content_types
BEGIN
  SELECT RAISE(ABORT, 'document upload request content type is immutable');
END;

CREATE TRIGGER document_upload_request_content_types_delete_forbidden
BEFORE DELETE ON document_upload_request_content_types
BEGIN
  SELECT RAISE(ABORT, 'document upload request content type is immutable');
END;
