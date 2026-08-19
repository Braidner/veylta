-- Rolling back and re-applying forgets every date a person corrected.
ALTER TABLE documents DROP COLUMN document_date_override;
