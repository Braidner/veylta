-- Page provenance is immutable for anything that was read from it. A page nothing was read
-- from — no extracted fact of any run bound to its row, no observation standing on one, no
-- clinician record confirmed off that page — is not evidence yet, so a later analysis may
-- replace its reading in place: the picture page a text pass could only see a letterhead on
-- becomes the transcription a vision pass returned, under the row id every fact binds by.
-- Which replacements are worth making is the processor's rule; what may never move is here.
DROP TRIGGER document_pages_update_forbidden;

CREATE TRIGGER document_pages_update_forbidden
BEFORE UPDATE ON document_pages
WHEN OLD.id <> NEW.id
  OR OLD.family_id <> NEW.family_id
  OR OLD.document_version_id <> NEW.document_version_id
  OR OLD.page_number <> NEW.page_number
  OR OLD.created_at <> NEW.created_at
  OR EXISTS (
    SELECT 1
      FROM extracted_facts f
     WHERE f.family_id = OLD.family_id
       AND f.document_version_id = OLD.document_version_id
       AND f.document_page_id = OLD.id
  )
  OR EXISTS (
    SELECT 1
      FROM observations o
     WHERE o.family_id = OLD.family_id
       AND o.document_version_id = OLD.document_version_id
       AND o.document_page_id = OLD.id
  )
  OR EXISTS (
    SELECT 1
      FROM clinician_records r
     WHERE r.family_id = OLD.family_id
       AND r.document_version_id = OLD.document_version_id
       AND r.page_number = OLD.page_number
  )
BEGIN
  SELECT RAISE(ABORT, 'document page provenance is immutable once something was read from it');
END;
