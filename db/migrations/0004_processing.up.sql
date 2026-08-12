CREATE TABLE processing_jobs (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  document_version_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'document_extraction'),
  dedupe_key TEXT NOT NULL,
  payload_version TEXT NOT NULL CHECK (
    payload_version = 'document-extraction-job/v1'
  ),
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'leased', 'retry_wait', 'succeeded', 'dead_letter')
  ),
  current_stage TEXT CHECK (
    current_stage IS NULL
    OR current_stage IN (
      'security_check',
      'text_extraction',
      'document_classification',
      'structured_extraction',
      'validation'
    )
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 100),
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, document_version_id, id),
  UNIQUE (kind, dedupe_key),
  FOREIGN KEY (family_id, document_version_id)
    REFERENCES document_versions(family_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT processing_jobs_dedupe_key_check CHECK (
    length(dedupe_key) BETWEEN 1 AND 300
    AND dedupe_key = trim(dedupe_key)
  ),
  CONSTRAINT processing_jobs_attempt_count_check CHECK (
    attempt_count BETWEEN 0 AND max_attempts
  ),
  CONSTRAINT processing_jobs_lease_owner_check CHECK (
    lease_owner IS NULL
    OR (
      length(lease_owner) BETWEEN 1 AND 200
      AND lease_owner = trim(lease_owner)
    )
  ),
  CONSTRAINT processing_jobs_error_code_check CHECK (
    last_error_code IS NULL
    OR (
      length(last_error_code) BETWEEN 1 AND 100
      AND last_error_code = trim(last_error_code)
    )
  ),
  CONSTRAINT processing_jobs_error_message_check CHECK (
    last_error_message IS NULL
    OR length(last_error_message) BETWEEN 1 AND 4000
  ),
  CONSTRAINT processing_jobs_error_pair_check CHECK (
    (last_error_code IS NULL) = (last_error_message IS NULL)
  ),
  CONSTRAINT processing_jobs_time_order_check CHECK (
    updated_at >= created_at
    AND (completed_at IS NULL OR completed_at >= created_at)
  ),
  CONSTRAINT processing_jobs_state_shape_check CHECK (
    (
      state = 'pending'
      AND attempt_count = 0
      AND current_stage IS NULL
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND last_error_code IS NULL
      AND last_error_message IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'leased'
      AND attempt_count BETWEEN 1 AND max_attempts
      AND current_stage IS NOT NULL
      AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > updated_at
      AND last_error_code IS NULL
      AND last_error_message IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'retry_wait'
      AND attempt_count BETWEEN 1 AND max_attempts - 1
      AND current_stage IS NULL
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND last_error_code IS NOT NULL
      AND last_error_message IS NOT NULL
      AND available_at > updated_at
      AND completed_at IS NULL
    )
    OR (
      state = 'succeeded'
      AND attempt_count BETWEEN 1 AND max_attempts
      AND current_stage IS NULL
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND last_error_code IS NULL
      AND last_error_message IS NULL
      AND completed_at IS NOT NULL
    )
    OR (
      state = 'dead_letter'
      AND attempt_count = max_attempts
      AND current_stage IS NULL
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND last_error_code IS NOT NULL
      AND last_error_message IS NOT NULL
      AND completed_at IS NOT NULL
    )
  )
);

CREATE INDEX processing_jobs_claimable
  ON processing_jobs (state, available_at, created_at)
  WHERE state IN ('pending', 'retry_wait');

CREATE INDEX processing_jobs_expired_leases
  ON processing_jobs (lease_expires_at)
  WHERE state = 'leased';

CREATE INDEX processing_jobs_document
  ON processing_jobs (family_id, document_version_id, created_at DESC);

CREATE TABLE processing_retry_requests (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  processing_job_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (
    length(idempotency_key_hash) = 64
    AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, actor_user_id, idempotency_key_hash),
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, document_version_id, processing_job_id)
    REFERENCES processing_jobs(family_id, document_version_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX processing_retry_requests_document
  ON processing_retry_requests (family_id, document_version_id, created_at DESC);

CREATE TRIGGER processing_retry_requests_dead_letter_only
BEFORE INSERT ON processing_retry_requests
WHEN NOT EXISTS (
  SELECT 1
    FROM processing_jobs
   WHERE family_id = NEW.family_id
     AND document_version_id = NEW.document_version_id
     AND id = NEW.processing_job_id
     AND state = 'dead_letter'
)
BEGIN
  SELECT RAISE(ABORT, 'processing retry requires a dead-letter job');
END;

CREATE TRIGGER processing_retry_requests_update_forbidden
BEFORE UPDATE ON processing_retry_requests
BEGIN
  SELECT RAISE(ABORT, 'processing retry requests are immutable');
END;

CREATE TRIGGER processing_retry_requests_delete_forbidden
BEFORE DELETE ON processing_retry_requests
BEGIN
  SELECT RAISE(ABORT, 'processing retry requests are immutable');
END;

CREATE TABLE extraction_runs (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  document_version_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  extractor_kind TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  output_schema_version TEXT NOT NULL CHECK (
    output_schema_version = 'lab-extraction/v1'
  ),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'awaiting_review', 'completed', 'failed')
  ),
  started_at TEXT,
  completed_at TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, document_version_id, id),
  UNIQUE (family_id, job_id),
  FOREIGN KEY (family_id, document_version_id, job_id)
    REFERENCES processing_jobs(family_id, document_version_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT extraction_runs_extractor_kind_check CHECK (
    length(extractor_kind) BETWEEN 1 AND 100
    AND extractor_kind = trim(extractor_kind)
  ),
  CONSTRAINT extraction_runs_extractor_version_check CHECK (
    length(extractor_version) BETWEEN 1 AND 100
    AND extractor_version = trim(extractor_version)
  ),
  CONSTRAINT extraction_runs_error_code_check CHECK (
    error_code IS NULL
    OR (
      length(error_code) BETWEEN 1 AND 100
      AND error_code = trim(error_code)
    )
  ),
  CONSTRAINT extraction_runs_error_message_check CHECK (
    error_message IS NULL OR length(error_message) BETWEEN 1 AND 4000
  ),
  CONSTRAINT extraction_runs_error_pair_check CHECK (
    (error_code IS NULL) = (error_message IS NULL)
  ),
  CONSTRAINT extraction_runs_time_order_check CHECK (
    (started_at IS NULL OR started_at >= created_at)
    AND (completed_at IS NULL OR completed_at >= coalesce(started_at, created_at))
  ),
  CONSTRAINT extraction_runs_status_shape_check CHECK (
    (
      status = 'queued'
      AND started_at IS NULL
      AND completed_at IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
    )
    OR (
      status = 'running'
      AND started_at IS NOT NULL
      AND completed_at IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
    )
    OR (
      status IN ('awaiting_review', 'completed')
      AND started_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND error_code IS NULL
      AND error_message IS NULL
    )
    OR (
      status = 'failed'
      AND started_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND error_code IS NOT NULL
      AND error_message IS NOT NULL
    )
  )
);

CREATE INDEX extraction_runs_document
  ON extraction_runs (family_id, document_version_id, created_at DESC);

CREATE TRIGGER extraction_runs_provenance_immutable
BEFORE UPDATE OF
  family_id,
  document_version_id,
  job_id,
  extractor_kind,
  extractor_version,
  output_schema_version,
  created_at
ON extraction_runs
BEGIN
  SELECT RAISE(ABORT, 'extraction run provenance is immutable');
END;

CREATE TRIGGER extraction_runs_delete_forbidden
BEFORE DELETE ON extraction_runs
BEGIN
  SELECT RAISE(ABORT, 'extraction runs are immutable');
END;

CREATE TABLE document_pages (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  document_version_id TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  extracted_text TEXT NOT NULL CHECK (length(extracted_text) <= 250000),
  extraction_method TEXT NOT NULL,
  extraction_version TEXT NOT NULL,
  text_sha256 TEXT NOT NULL CHECK (
    length(text_sha256) = 64 AND text_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, document_version_id, id),
  UNIQUE (family_id, document_version_id, page_number),
  FOREIGN KEY (family_id, document_version_id)
    REFERENCES document_versions(family_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT document_pages_extraction_method_check CHECK (
    length(extraction_method) BETWEEN 1 AND 100
    AND extraction_method = trim(extraction_method)
  ),
  CONSTRAINT document_pages_extraction_version_check CHECK (
    length(extraction_version) BETWEEN 1 AND 100
    AND extraction_version = trim(extraction_version)
  )
);

CREATE INDEX document_pages_document
  ON document_pages (family_id, document_version_id, page_number);

CREATE TRIGGER document_pages_update_forbidden
BEFORE UPDATE ON document_pages
BEGIN
  SELECT RAISE(ABORT, 'document page provenance is immutable');
END;

CREATE TRIGGER document_pages_delete_forbidden
BEFORE DELETE ON document_pages
BEGIN
  SELECT RAISE(ABORT, 'document page provenance is immutable');
END;

CREATE TABLE extracted_facts (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  document_version_id TEXT NOT NULL,
  extraction_run_id TEXT NOT NULL,
  document_page_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  source_fragment TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_value TEXT NOT NULL,
  source_unit TEXT NOT NULL,
  proposed_canonical_code TEXT,
  proposed_normalized_value TEXT,
  proposed_normalized_unit TEXT,
  proposed_reference_range TEXT,
  proposed_specimen TEXT,
  proposed_sampled_at TEXT,
  proposed_resulted_at TEXT,
  proposed_laboratory TEXT,
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0),
  validation_issues TEXT NOT NULL DEFAULT '[]',
  review_status TEXT NOT NULL CHECK (
    review_status IN ('extracted', 'needs_review')
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, extraction_run_id, fact_key),
  FOREIGN KEY (family_id, document_version_id, extraction_run_id)
    REFERENCES extraction_runs(family_id, document_version_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, document_version_id, document_page_id)
    REFERENCES document_pages(family_id, document_version_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT extracted_facts_fact_key_check CHECK (
    length(fact_key) BETWEEN 1 AND 100
    AND fact_key = trim(fact_key)
  ),
  CONSTRAINT extracted_facts_source_fragment_check CHECK (
    length(source_fragment) BETWEEN 1 AND 4000
  ),
  CONSTRAINT extracted_facts_source_name_check CHECK (
    length(source_name) BETWEEN 1 AND 200
    AND source_name = trim(source_name)
  ),
  CONSTRAINT extracted_facts_source_value_check CHECK (
    length(source_value) BETWEEN 1 AND 100
    AND source_value = trim(source_value)
  ),
  CONSTRAINT extracted_facts_source_unit_check CHECK (
    length(source_unit) BETWEEN 1 AND 100
    AND source_unit = trim(source_unit)
  ),
  CONSTRAINT extracted_facts_proposed_canonical_code_check CHECK (
    proposed_canonical_code IS NULL
    OR (
      length(proposed_canonical_code) BETWEEN 1 AND 100
      AND proposed_canonical_code = trim(proposed_canonical_code)
    )
  ),
  CONSTRAINT extracted_facts_proposed_normalized_value_check CHECK (
    proposed_normalized_value IS NULL
    OR (
      length(proposed_normalized_value) BETWEEN 1 AND 100
      AND proposed_normalized_value = trim(proposed_normalized_value)
    )
  ),
  CONSTRAINT extracted_facts_proposed_normalized_unit_check CHECK (
    proposed_normalized_unit IS NULL
    OR (
      length(proposed_normalized_unit) BETWEEN 1 AND 100
      AND proposed_normalized_unit = trim(proposed_normalized_unit)
    )
  ),
  CONSTRAINT extracted_facts_normalized_pair_check CHECK (
    (proposed_normalized_value IS NULL) = (proposed_normalized_unit IS NULL)
  ),
  CONSTRAINT extracted_facts_reference_range_check CHECK (
    proposed_reference_range IS NULL
    OR (
      json_valid(proposed_reference_range)
      AND json_type(proposed_reference_range) = 'object'
    )
  ),
  CONSTRAINT extracted_facts_proposed_specimen_check CHECK (
    proposed_specimen IS NULL
    OR (
      length(proposed_specimen) BETWEEN 1 AND 200
      AND proposed_specimen = trim(proposed_specimen)
    )
  ),
  CONSTRAINT extracted_facts_proposed_time_order_check CHECK (
    proposed_sampled_at IS NULL
    OR proposed_resulted_at IS NULL
    OR proposed_resulted_at >= proposed_sampled_at
  ),
  CONSTRAINT extracted_facts_proposed_laboratory_check CHECK (
    proposed_laboratory IS NULL
    OR (
      length(proposed_laboratory) BETWEEN 1 AND 200
      AND proposed_laboratory = trim(proposed_laboratory)
    )
  ),
  CONSTRAINT extracted_facts_validation_issues_check CHECK (
    json_valid(validation_issues)
    AND json_type(validation_issues) = 'array'
  )
);

CREATE INDEX extracted_facts_review_queue
  ON extracted_facts (family_id, review_status, created_at)
  WHERE review_status = 'needs_review';

CREATE TRIGGER extracted_facts_update_forbidden
BEFORE UPDATE ON extracted_facts
BEGIN
  SELECT RAISE(ABORT, 'extracted facts are immutable');
END;

CREATE TRIGGER extracted_facts_delete_forbidden
BEFORE DELETE ON extracted_facts
BEGIN
  SELECT RAISE(ABORT, 'extracted facts are immutable');
END;
