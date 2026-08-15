-- Diagnostics for one Codex attempt: the bounded request we sent, the raw response we
-- received, and the exact rule that rejected it. This is a deliberate exception to the
-- payload-free journal rule: the owner needs to see why a run failed. Audit events stay
-- payload-free — nothing here is copied into audit_events.
CREATE TABLE processing_job_exchanges (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  document_version_id TEXT NOT NULL,
  processing_job_id TEXT NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 100),
  stage TEXT NOT NULL CHECK (
    stage IN (
      'security_check',
      'text_extraction',
      'document_classification',
      'structured_extraction',
      'validation'
    )
  ),
  model_id TEXT NOT NULL CHECK (
    length(model_id) BETWEEN 1 AND 100
    AND model_id = trim(model_id)
  ),
  runtime_version TEXT CHECK (
    runtime_version IS NULL
    OR (length(runtime_version) BETWEEN 1 AND 100 AND runtime_version = trim(runtime_version))
  ),
  page_count INTEGER NOT NULL CHECK (page_count BETWEEN 0 AND 1000),
  request_bytes INTEGER NOT NULL CHECK (request_bytes >= 0),
  response_bytes INTEGER NOT NULL CHECK (response_bytes >= 0),
  -- Bounded copies. The worker truncates before insert; the CHECK is the backstop.
  request_text TEXT NOT NULL CHECK (length(request_text) <= 65536),
  response_text TEXT NOT NULL CHECK (length(response_text) <= 65536),
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'unavailable')),
  rejection_reason TEXT CHECK (
    rejection_reason IS NULL
    OR rejection_reason IN (
      'schema_shape',
      'not_russian',
      'unknown_page',
      'fragment_not_on_page',
      'invalid_key',
      'invalid_number',
      'invalid_timestamp',
      'inconsistent_fields',
      'provider_unavailable',
      'input_invalid'
    )
  ),
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 86400000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, processing_job_id, attempt),
  FOREIGN KEY (family_id, document_version_id, processing_job_id)
    REFERENCES processing_jobs(family_id, document_version_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT processing_job_exchange_outcome_shape CHECK (
    (outcome = 'accepted' AND rejection_reason IS NULL)
    OR (outcome <> 'accepted' AND rejection_reason IS NOT NULL)
  )
);

CREATE INDEX processing_job_exchanges_job
  ON processing_job_exchanges (family_id, processing_job_id, attempt);

CREATE TRIGGER processing_job_exchanges_update_forbidden
BEFORE UPDATE ON processing_job_exchanges
BEGIN
  SELECT RAISE(ABORT, 'processing job exchanges are immutable');
END;

CREATE TRIGGER processing_job_exchanges_delete_forbidden
BEFORE DELETE ON processing_job_exchanges
BEGIN
  SELECT RAISE(ABORT, 'processing job exchanges are immutable');
END;
