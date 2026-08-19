-- The person's correction of a document's date; NULL means the document's own date or the upload day applies.
ALTER TABLE documents ADD COLUMN document_date_override TEXT CHECK (
  document_date_override IS NULL
  OR (
    length(document_date_override) = 10
    AND document_date_override GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(document_date_override) = document_date_override
  )
);
