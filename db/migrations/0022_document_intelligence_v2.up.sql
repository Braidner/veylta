PRAGMA defer_foreign_keys = ON;

DROP TRIGGER document_intelligence_results_delete_forbidden;
DROP TRIGGER document_intelligence_results_update_forbidden;
DROP INDEX document_intelligence_results_document;

ALTER TABLE document_intelligence_results
  RENAME TO document_intelligence_results_0021;

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
    schema_version IN ('document-intelligence/v1', 'document-intelligence/v2')
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
  short_summary TEXT NOT NULL,
  detailed_summary TEXT NOT NULL,
  structured_results_json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  document_date TEXT,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, processing_job_id),
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
  CONSTRAINT document_intelligence_short_summary_check CHECK (
    length(short_summary) BETWEEN 1 AND 500
    AND short_summary = trim(short_summary)
  ),
  CONSTRAINT document_intelligence_detailed_summary_check CHECK (
    length(detailed_summary) BETWEEN 1 AND 4000
    AND detailed_summary = trim(detailed_summary)
  ),
  CONSTRAINT document_intelligence_structured_results_check CHECK (
    length(structured_results_json) BETWEEN 2 AND 262144
    AND json_valid(structured_results_json)
    AND json_type(structured_results_json) = 'array'
  ),
  CONSTRAINT document_intelligence_search_text_check CHECK (
    length(search_text) BETWEEN 1 AND 32000
    AND search_text = trim(search_text)
    AND instr(search_text, '  ') = 0
    AND instr(search_text, char(9)) = 0
    AND instr(search_text, char(10)) = 0
    AND instr(search_text, char(13)) = 0
  ),
  CONSTRAINT document_intelligence_date_check CHECK (
    document_date IS NULL
    OR (
      length(document_date) = 10
      AND date(document_date) = document_date
    )
  )
);

INSERT INTO document_intelligence_results
  (id, family_id, document_id, document_version_id, processing_job_id,
   provider, model_id, runtime_version, schema_version, category, title,
   short_summary, detailed_summary, structured_results_json, search_text,
   document_date, confidence, created_at)
SELECT id, family_id, document_id, document_version_id, processing_job_id,
       provider, model_id, runtime_version, schema_version, category, title,
       'Результат предыдущей версии без краткого описания.',
       'Результат предыдущей версии не содержит подробного описания.',
       '[]', 'результат предыдущей версии',
       document_date, confidence, created_at
  FROM document_intelligence_results_0021;

DROP TABLE document_intelligence_results_0021;

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
