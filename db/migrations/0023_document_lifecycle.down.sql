CREATE TABLE document_lifecycle_rollback_guard (
  allowed INTEGER NOT NULL CHECK (allowed = 0)
);

INSERT INTO document_lifecycle_rollback_guard (allowed)
SELECT 1
 WHERE EXISTS (SELECT 1 FROM documents WHERE deleted_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM document_upload_reuse_requests)
    OR EXISTS (SELECT 1 FROM document_delete_requests);

DROP TABLE document_lifecycle_rollback_guard;

DROP TRIGGER document_delete_requests_delete_forbidden;
DROP TRIGGER document_delete_requests_update_forbidden;
DROP TRIGGER document_delete_requests_matches_tombstone;
DROP INDEX document_delete_requests_document;
DROP TABLE document_delete_requests;

DROP TRIGGER document_upload_reuse_requests_delete_forbidden;
DROP TRIGGER document_upload_reuse_requests_update_forbidden;
DROP INDEX document_upload_reuse_requests_document;
DROP TABLE document_upload_reuse_requests;

DROP TRIGGER documents_hard_delete_forbidden;
DROP TRIGGER documents_delete_metadata_consistent;
DROP INDEX documents_active_profile_time;

ALTER TABLE documents DROP COLUMN deleted_by_user_id;
ALTER TABLE documents DROP COLUMN deleted_at;
