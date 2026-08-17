-- The clinician's own statements read out of a document — a diagnosis, a prescription, a
-- referral, a follow-up, a procedure, a finding — become a record only by a person's decision,
-- one per statement of one analysis. Confirmed records are what the assistants read and what
-- the сверка compares against; rejected ones stay so the statement is not asked about again.
CREATE TABLE clinician_records (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  patient_profile_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  intelligence_result_id TEXT NOT NULL,
  result_key TEXT NOT NULL CHECK (length(result_key) BETWEEN 1 AND 100),
  kind TEXT NOT NULL CHECK (
    kind IN ('diagnosis', 'medication', 'procedure', 'referral', 'follow_up', 'finding')
  ),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 500 AND label = trim(label)),
  detail TEXT CHECK (detail IS NULL OR (length(detail) BETWEEN 1 AND 500 AND detail = trim(detail))),
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  source_fragment TEXT NOT NULL CHECK (length(source_fragment) BETWEEN 1 AND 4000),
  document_date TEXT CHECK (document_date IS NULL OR document_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  decision TEXT NOT NULL CHECK (decision IN ('confirmed', 'rejected')),
  decided_by_user_id TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, intelligence_result_id, result_key),
  FOREIGN KEY (family_id, intelligence_result_id)
    REFERENCES document_intelligence_results(family_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (family_id, document_id, document_version_id)
    REFERENCES document_versions(family_id, document_id, id) ON DELETE RESTRICT
);

CREATE INDEX clinician_records_profile
  ON clinician_records (family_id, patient_profile_id, decision, decided_at DESC);

-- A decision is a record of what a person did; it is never edited or erased in place.
CREATE TRIGGER clinician_records_update_forbidden
BEFORE UPDATE ON clinician_records
BEGIN
  SELECT RAISE(ABORT, 'clinician records are immutable');
END;

CREATE TRIGGER clinician_records_delete_forbidden
BEFORE DELETE ON clinician_records
BEGIN
  SELECT RAISE(ABORT, 'clinician records are immutable');
END;
