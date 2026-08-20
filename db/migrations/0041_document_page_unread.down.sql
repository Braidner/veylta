-- Rolling back forgets which pages an analysis could not read. Re-applying leaves the column
-- NULL on every existing row: the record is rebuilt only when a document is analysed again.
ALTER TABLE document_pages DROP COLUMN unread_reason;
