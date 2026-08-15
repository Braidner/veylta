CREATE TABLE processing_job_events (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  document_version_id TEXT NOT NULL,
  processing_job_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 1000),
  code TEXT NOT NULL CHECK (
    code IN (
      'queued',
      'security_check_started',
      'text_extraction_started',
      'document_classification_started',
      'codex_analysis_started',
      'result_validation_started',
      'result_saved',
      'retry_scheduled',
      'failed'
    )
  ),
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 0 AND 100),
  occurred_at TEXT NOT NULL CHECK (
    length(occurred_at) = 24
    AND substr(occurred_at, 5, 1) = '-'
    AND substr(occurred_at, 8, 1) = '-'
    AND substr(occurred_at, 11, 1) = 'T'
    AND substr(occurred_at, 24, 1) = 'Z'
  ),
  UNIQUE (family_id, id),
  UNIQUE (family_id, processing_job_id, sequence),
  FOREIGN KEY (family_id, document_version_id, processing_job_id)
    REFERENCES processing_jobs(family_id, document_version_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX processing_job_events_timeline
  ON processing_job_events (family_id, processing_job_id, sequence);

CREATE TRIGGER processing_job_events_update_forbidden
BEFORE UPDATE ON processing_job_events
BEGIN
  SELECT RAISE(ABORT, 'processing job events are immutable');
END;

CREATE TRIGGER processing_job_events_delete_forbidden
BEFORE DELETE ON processing_job_events
BEGIN
  SELECT RAISE(ABORT, 'processing job events are immutable');
END;
