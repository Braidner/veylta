CREATE TABLE direct_image_documents_rollback_guard (
  allowed INTEGER NOT NULL CHECK (allowed = 1)
);

INSERT INTO direct_image_documents_rollback_guard (allowed)
SELECT 0
 WHERE EXISTS (
   SELECT 1
     FROM document_blob_content_types
    WHERE content_type <> 'application/pdf'
 )
    OR EXISTS (
   SELECT 1
     FROM document_upload_request_content_types
    WHERE content_type <> 'application/pdf'
 );

DROP TABLE direct_image_documents_rollback_guard;

DROP TRIGGER document_upload_request_content_types_delete_forbidden;
DROP TRIGGER document_upload_request_content_types_update_forbidden;
DROP TABLE document_upload_request_content_types;

DROP TRIGGER document_blob_content_types_delete_forbidden;
DROP TRIGGER document_blob_content_types_update_forbidden;
DROP TABLE document_blob_content_types;
