DROP TRIGGER document_pages_update_forbidden;

CREATE TRIGGER document_pages_update_forbidden
BEFORE UPDATE ON document_pages
BEGIN
  SELECT RAISE(ABORT, 'document page provenance is immutable');
END;
