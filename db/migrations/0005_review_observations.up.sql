CREATE UNIQUE INDEX document_versions_family_document_id
  ON document_versions (family_id, document_id, id);

CREATE UNIQUE INDEX extracted_facts_family_document_version_id
  ON extracted_facts (family_id, document_version_id, id);

CREATE UNIQUE INDEX extracted_facts_family_document_page_id
  ON extracted_facts (family_id, id, document_version_id, document_page_id);

CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  extracted_fact_id TEXT NOT NULL,
  source_fact_version INTEGER NOT NULL CHECK (source_fact_version = 1),
  outcome TEXT NOT NULL CHECK (outcome IN ('confirm', 'correct', 'reject')),
  corrected_source_name TEXT,
  corrected_source_value TEXT,
  corrected_source_unit TEXT,
  observation_id TEXT,
  decided_by_user_id TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, extracted_fact_id),
  UNIQUE (family_id, id, extracted_fact_id),
  UNIQUE (family_id, id, decided_by_user_id, extracted_fact_id),
  UNIQUE (family_id, decided_by_user_id, extracted_fact_id, id),
  FOREIGN KEY (family_id, extracted_fact_id)
    REFERENCES extracted_facts(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, decided_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT review_decisions_correction_shape_check CHECK (
    (
      outcome = 'confirm'
      AND corrected_source_name IS NULL
      AND corrected_source_value IS NULL
      AND corrected_source_unit IS NULL
      AND observation_id IS NOT NULL
    )
    OR (
      outcome = 'correct'
      AND corrected_source_name IS NOT NULL
      AND corrected_source_value IS NOT NULL
      AND corrected_source_unit IS NOT NULL
      AND observation_id IS NOT NULL
    )
    OR (
      outcome = 'reject'
      AND corrected_source_name IS NULL
      AND corrected_source_value IS NULL
      AND corrected_source_unit IS NULL
      AND observation_id IS NULL
    )
  ),
  CONSTRAINT review_decisions_corrected_source_name_check CHECK (
    corrected_source_name IS NULL
    OR (
      length(corrected_source_name) BETWEEN 1 AND 200
      AND corrected_source_name = trim(corrected_source_name)
    )
  ),
  CONSTRAINT review_decisions_corrected_source_value_check CHECK (
    corrected_source_value IS NULL
    OR (
      length(corrected_source_value) BETWEEN 1 AND 100
      AND corrected_source_value = trim(corrected_source_value)
    )
  ),
  CONSTRAINT review_decisions_corrected_source_unit_check CHECK (
    corrected_source_unit IS NULL
    OR (
      length(corrected_source_unit) BETWEEN 1 AND 100
      AND corrected_source_unit = trim(corrected_source_unit)
    )
  )
);

CREATE INDEX review_decisions_family_time
  ON review_decisions (family_id, decided_at DESC);

CREATE INDEX review_decisions_fact
  ON review_decisions (family_id, extracted_fact_id);

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  patient_profile_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  document_page_id TEXT NOT NULL,
  source_extracted_fact_id TEXT NOT NULL,
  source_fact_version INTEGER NOT NULL CHECK (source_fact_version = 1),
  review_decision_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'confirmed'),
  canonical_code TEXT,
  source_name TEXT NOT NULL,
  source_value TEXT NOT NULL,
  source_unit TEXT NOT NULL,
  normalized_value TEXT,
  normalized_unit TEXT,
  conversion_version TEXT,
  sampled_at TEXT,
  resulted_at TEXT,
  uploaded_at TEXT NOT NULL,
  specimen_type TEXT,
  laboratory TEXT,
  source_fragment TEXT NOT NULL,
  extraction_confidence REAL NOT NULL CHECK (extraction_confidence BETWEEN 0.0 AND 1.0),
  confirmed_by_user_id TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, source_extracted_fact_id),
  UNIQUE (family_id, id, source_extracted_fact_id),
  UNIQUE (family_id, review_decision_id),
  FOREIGN KEY (family_id, patient_profile_id, document_id)
    REFERENCES documents(family_id, patient_profile_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, document_id, document_version_id)
    REFERENCES document_versions(family_id, document_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, document_version_id, document_page_id)
    REFERENCES document_pages(family_id, document_version_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    family_id,
    source_extracted_fact_id,
    document_version_id,
    document_page_id
  )
    REFERENCES extracted_facts(
      family_id,
      id,
      document_version_id,
      document_page_id
    )
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, confirmed_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, review_decision_id, source_extracted_fact_id)
    REFERENCES review_decisions(family_id, id, extracted_fact_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT observations_canonical_code_check CHECK (
    canonical_code IS NULL
    OR (
      length(canonical_code) BETWEEN 1 AND 100
      AND canonical_code = trim(canonical_code)
    )
  ),
  CONSTRAINT observations_source_name_check CHECK (
    length(source_name) BETWEEN 1 AND 200
    AND source_name = trim(source_name)
  ),
  CONSTRAINT observations_source_value_check CHECK (
    length(source_value) BETWEEN 1 AND 100
    AND source_value = trim(source_value)
  ),
  CONSTRAINT observations_source_unit_check CHECK (
    length(source_unit) BETWEEN 1 AND 100
    AND source_unit = trim(source_unit)
  ),
  CONSTRAINT observations_normalized_value_check CHECK (
    normalized_value IS NULL
    OR (
      length(normalized_value) BETWEEN 1 AND 100
      AND normalized_value = trim(normalized_value)
    )
  ),
  CONSTRAINT observations_normalized_unit_check CHECK (
    normalized_unit IS NULL
    OR (
      length(normalized_unit) BETWEEN 1 AND 100
      AND normalized_unit = trim(normalized_unit)
    )
  ),
  CONSTRAINT observations_conversion_version_check CHECK (
    conversion_version IS NULL
    OR (
      length(conversion_version) BETWEEN 1 AND 100
      AND conversion_version = trim(conversion_version)
    )
  ),
  CONSTRAINT observations_normalization_shape_check CHECK (
    (
      normalized_value IS NULL
      AND normalized_unit IS NULL
      AND conversion_version IS NULL
    )
    OR (
      normalized_value IS NOT NULL
      AND normalized_unit IS NOT NULL
      AND conversion_version IS NOT NULL
    )
  ),
  CONSTRAINT observations_sample_result_time_check CHECK (
    sampled_at IS NULL
    OR resulted_at IS NULL
    OR resulted_at >= sampled_at
  ),
  CONSTRAINT observations_specimen_type_check CHECK (
    specimen_type IS NULL
    OR (
      length(specimen_type) BETWEEN 1 AND 200
      AND specimen_type = trim(specimen_type)
    )
  ),
  CONSTRAINT observations_laboratory_check CHECK (
    laboratory IS NULL
    OR (
      length(laboratory) BETWEEN 1 AND 200
      AND laboratory = trim(laboratory)
    )
  ),
  CONSTRAINT observations_source_fragment_check CHECK (
    length(source_fragment) BETWEEN 1 AND 4000
  )
);

CREATE INDEX observations_profile_time
  ON observations (family_id, patient_profile_id, sampled_at DESC, resulted_at DESC, uploaded_at DESC);

CREATE INDEX observations_indicator_time
  ON observations (family_id, patient_profile_id, canonical_code, sampled_at DESC, resulted_at DESC);

CREATE TABLE observation_reference_ranges (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  observation_id TEXT NOT NULL,
  source_text TEXT,
  source_low TEXT,
  source_high TEXT,
  source_unit TEXT,
  laboratory_out_of_range INTEGER,
  normalized_low TEXT,
  normalized_high TEXT,
  normalized_unit TEXT,
  conversion_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, observation_id),
  FOREIGN KEY (family_id, observation_id)
    REFERENCES observations(family_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT observation_reference_ranges_source_content_check CHECK (
    source_text IS NOT NULL
    OR source_low IS NOT NULL
    OR source_high IS NOT NULL
    OR source_unit IS NOT NULL
    OR laboratory_out_of_range IS NOT NULL
  ),
  CONSTRAINT observation_reference_ranges_source_text_check CHECK (
    source_text IS NULL OR length(source_text) BETWEEN 1 AND 1000
  ),
  CONSTRAINT observation_reference_ranges_source_low_check CHECK (
    source_low IS NULL
    OR (length(source_low) BETWEEN 1 AND 100 AND source_low = trim(source_low))
  ),
  CONSTRAINT observation_reference_ranges_source_high_check CHECK (
    source_high IS NULL
    OR (length(source_high) BETWEEN 1 AND 100 AND source_high = trim(source_high))
  ),
  CONSTRAINT observation_reference_ranges_source_unit_check CHECK (
    source_unit IS NULL
    OR (length(source_unit) BETWEEN 1 AND 100 AND source_unit = trim(source_unit))
  ),
  CONSTRAINT observation_reference_ranges_laboratory_flag_check CHECK (
    laboratory_out_of_range IS NULL OR laboratory_out_of_range IN (0, 1)
  ),
  CONSTRAINT observation_reference_ranges_normalized_low_check CHECK (
    normalized_low IS NULL
    OR (length(normalized_low) BETWEEN 1 AND 100 AND normalized_low = trim(normalized_low))
  ),
  CONSTRAINT observation_reference_ranges_normalized_high_check CHECK (
    normalized_high IS NULL
    OR (length(normalized_high) BETWEEN 1 AND 100 AND normalized_high = trim(normalized_high))
  ),
  CONSTRAINT observation_reference_ranges_normalized_unit_check CHECK (
    normalized_unit IS NULL
    OR (length(normalized_unit) BETWEEN 1 AND 100 AND normalized_unit = trim(normalized_unit))
  ),
  CONSTRAINT observation_reference_ranges_conversion_version_check CHECK (
    conversion_version IS NULL
    OR (
      length(conversion_version) BETWEEN 1 AND 100
      AND conversion_version = trim(conversion_version)
    )
  ),
  CONSTRAINT observation_reference_ranges_normalization_shape_check CHECK (
    (
      normalized_low IS NULL
      AND normalized_high IS NULL
      AND normalized_unit IS NULL
      AND conversion_version IS NULL
    )
    OR (
      (normalized_low IS NOT NULL OR normalized_high IS NOT NULL)
      AND normalized_unit IS NOT NULL
      AND conversion_version IS NOT NULL
    )
  )
);

CREATE TABLE review_requests (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL,
  extracted_fact_id TEXT NOT NULL,
  review_decision_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (
    length(idempotency_key_hash) = 64
    AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*'
  ),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 64
    AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, actor_user_id, idempotency_key_hash),
  UNIQUE (family_id, review_decision_id),
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (
    family_id,
    actor_user_id,
    extracted_fact_id,
    review_decision_id
  )
    REFERENCES review_decisions(
      family_id,
      decided_by_user_id,
      extracted_fact_id,
      id
    )
    ON DELETE RESTRICT
);

CREATE INDEX review_requests_fact
  ON review_requests (family_id, extracted_fact_id, created_at DESC);

CREATE TRIGGER review_decisions_update_forbidden
BEFORE UPDATE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'review decisions are immutable');
END;

CREATE TRIGGER review_decisions_confirmed_observation_required
BEFORE INSERT ON review_decisions
WHEN NEW.outcome IN ('confirm', 'correct')
 AND NOT EXISTS (
   SELECT 1
     FROM observations
    WHERE family_id = NEW.family_id
      AND id = NEW.observation_id
      AND source_extracted_fact_id = NEW.extracted_fact_id
      AND review_decision_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'review decision requires its confirmed observation');
END;

CREATE TRIGGER review_decisions_rejected_observation_forbidden
BEFORE INSERT ON review_decisions
WHEN NEW.outcome = 'reject'
 AND EXISTS (
   SELECT 1
     FROM observations
    WHERE family_id = NEW.family_id
      AND source_extracted_fact_id = NEW.extracted_fact_id
      AND review_decision_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'rejected review decision cannot have an observation');
END;

CREATE TRIGGER review_decisions_delete_forbidden
BEFORE DELETE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'review decisions are immutable');
END;

CREATE TRIGGER observations_update_forbidden
BEFORE UPDATE ON observations
BEGIN
  SELECT RAISE(ABORT, 'observations are immutable');
END;

CREATE TRIGGER observations_rejected_decision_forbidden
BEFORE INSERT ON observations
WHEN EXISTS (
  SELECT 1
    FROM review_decisions
   WHERE family_id = NEW.family_id
     AND id = NEW.review_decision_id
     AND extracted_fact_id = NEW.source_extracted_fact_id
     AND outcome = 'reject'
)
BEGIN
  SELECT RAISE(ABORT, 'rejected review decision cannot have an observation');
END;

CREATE TRIGGER observations_delete_forbidden
BEFORE DELETE ON observations
BEGIN
  SELECT RAISE(ABORT, 'observations are immutable');
END;

CREATE TRIGGER observation_reference_ranges_update_forbidden
BEFORE UPDATE ON observation_reference_ranges
BEGIN
  SELECT RAISE(ABORT, 'observation reference ranges are immutable');
END;

CREATE TRIGGER observation_reference_ranges_delete_forbidden
BEFORE DELETE ON observation_reference_ranges
BEGIN
  SELECT RAISE(ABORT, 'observation reference ranges are immutable');
END;

CREATE TRIGGER review_requests_update_forbidden
BEFORE UPDATE ON review_requests
BEGIN
  SELECT RAISE(ABORT, 'review requests are immutable');
END;

CREATE TRIGGER review_requests_delete_forbidden
BEFORE DELETE ON review_requests
BEGIN
  SELECT RAISE(ABORT, 'review requests are immutable');
END;
