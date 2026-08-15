CREATE UNIQUE INDEX document_versions_intelligence_scope
  ON document_versions (family_id, document_id, id);

CREATE TABLE document_intelligence_results (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  processing_job_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'codex'),
  model_id TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  schema_version TEXT NOT NULL CHECK (
    schema_version = 'document-intelligence/v1'
  ),
  category TEXT NOT NULL CHECK (
    category IN (
      'laboratory',
      'imaging',
      'prescription',
      'discharge_summary',
      'consultation',
      'vaccination',
      'insurance',
      'other'
    )
  ),
  title TEXT NOT NULL,
  document_date TEXT,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, document_version_id),
  FOREIGN KEY (family_id, document_id, document_version_id)
    REFERENCES document_versions(family_id, document_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, document_version_id, processing_job_id)
    REFERENCES processing_jobs(family_id, document_version_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_intelligence_model_check CHECK (
    length(model_id) BETWEEN 1 AND 100
    AND model_id = trim(model_id)
  ),
  CONSTRAINT document_intelligence_runtime_check CHECK (
    length(runtime_version) BETWEEN 1 AND 100
    AND runtime_version = trim(runtime_version)
  ),
  CONSTRAINT document_intelligence_title_check CHECK (
    length(title) BETWEEN 1 AND 200
    AND title = trim(title)
  ),
  CONSTRAINT document_intelligence_date_check CHECK (
    document_date IS NULL
    OR (
      length(document_date) = 10
      AND date(document_date) = document_date
    )
  )
);

CREATE INDEX document_intelligence_results_document
  ON document_intelligence_results (family_id, document_id, created_at DESC);

CREATE TRIGGER document_intelligence_results_update_forbidden
BEFORE UPDATE ON document_intelligence_results
BEGIN
  SELECT RAISE(ABORT, 'document intelligence results are immutable');
END;

CREATE TRIGGER document_intelligence_results_delete_forbidden
BEFORE DELETE ON document_intelligence_results
BEGIN
  SELECT RAISE(ABORT, 'document intelligence results are immutable');
END;
