CREATE TABLE health_summaries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  patient_profile_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  previous_summary_id TEXT,
  summary_contract_version TEXT NOT NULL CHECK (summary_contract_version = 'health-summary/v1'),
  included_evidence_count INTEGER NOT NULL CHECK (included_evidence_count BETWEEN 1 AND 50),
  available_confirmed_observation_count INTEGER NOT NULL CHECK (
    available_confirmed_observation_count >= included_evidence_count
  ),
  missing_data TEXT NOT NULL CHECK (json_valid(missing_data) AND json_type(missing_data) = 'array'),
  recommendation_codes TEXT NOT NULL CHECK (
    json_valid(recommendation_codes) AND json_type(recommendation_codes) = 'array'
  ),
  created_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  UNIQUE (family_id, patient_profile_id, version),
  UNIQUE (family_id, id, patient_profile_id),
  FOREIGN KEY (family_id, patient_profile_id)
    REFERENCES patient_profiles(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, previous_summary_id, patient_profile_id)
    REFERENCES health_summaries(family_id, id, patient_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT health_summaries_previous_version_check CHECK (
    (version = 1 AND previous_summary_id IS NULL)
    OR (version > 1 AND previous_summary_id IS NOT NULL)
  )
);

CREATE TABLE health_summary_evidence (
  health_summary_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  observation_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 1),
  is_new_since_previous_summary INTEGER NOT NULL CHECK (is_new_since_previous_summary IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (health_summary_id, observation_id),
  UNIQUE (family_id, health_summary_id, position),
  FOREIGN KEY (family_id, health_summary_id)
    REFERENCES health_summaries(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, observation_id)
    REFERENCES observations(family_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX health_summaries_profile_version
  ON health_summaries (family_id, patient_profile_id, version DESC);

CREATE INDEX health_summary_evidence_observation
  ON health_summary_evidence (family_id, observation_id);

CREATE TRIGGER health_summaries_update_forbidden
BEFORE UPDATE ON health_summaries
BEGIN
  SELECT RAISE(ABORT, 'health summaries are immutable');
END;

CREATE TRIGGER health_summaries_previous_summary_required
BEFORE INSERT ON health_summaries
WHEN NEW.version > 1
 AND NOT EXISTS (
   SELECT 1
     FROM health_summaries previous
    WHERE previous.family_id = NEW.family_id
      AND previous.id = NEW.previous_summary_id
      AND previous.patient_profile_id = NEW.patient_profile_id
      AND previous.version = NEW.version - 1
 )
BEGIN
  SELECT RAISE(ABORT, 'health summary requires the previous profile version');
END;

CREATE TRIGGER health_summaries_metadata_shape_required
BEFORE INSERT ON health_summaries
WHEN EXISTS (
  SELECT 1
    FROM json_each(NEW.missing_data)
   WHERE type <> 'text'
      OR value NOT IN (
        'confirmed_observations',
        'sample_date',
        'result_date',
        'laboratory',
        'canonical_indicator'
      )
)
 OR EXISTS (
  SELECT 1
    FROM json_each(NEW.recommendation_codes)
   WHERE type <> 'text'
      OR value NOT IN ('prepare_source_for_clinician', 'complete_pending_review')
)
 OR json_array_length(NEW.missing_data) <> (
   SELECT count(DISTINCT value) FROM json_each(NEW.missing_data)
 )
 OR json_array_length(NEW.recommendation_codes) <> (
   SELECT count(DISTINCT value) FROM json_each(NEW.recommendation_codes)
 )
 OR NEW.available_confirmed_observation_count <> (
   SELECT count(*)
     FROM observations observation
    WHERE observation.family_id = NEW.family_id
      AND observation.patient_profile_id = NEW.patient_profile_id
      AND observation.status = 'confirmed'
 )
BEGIN
  SELECT RAISE(ABORT, 'health summary metadata is invalid');
END;

CREATE TRIGGER health_summaries_delete_forbidden
BEFORE DELETE ON health_summaries
BEGIN
  SELECT RAISE(ABORT, 'health summaries are immutable');
END;

CREATE TRIGGER health_summary_evidence_update_forbidden
BEFORE UPDATE ON health_summary_evidence
BEGIN
  SELECT RAISE(ABORT, 'health summary evidence is immutable');
END;

CREATE TRIGGER health_summary_evidence_profile_and_status_required
BEFORE INSERT ON health_summary_evidence
WHEN NOT EXISTS (
  SELECT 1
    FROM health_summaries summary
    JOIN observations observation
      ON observation.family_id = summary.family_id
     AND observation.id = NEW.observation_id
   WHERE summary.family_id = NEW.family_id
     AND summary.id = NEW.health_summary_id
     AND observation.patient_profile_id = summary.patient_profile_id
     AND observation.status = 'confirmed'
)
BEGIN
  SELECT RAISE(ABORT, 'health summary evidence must be confirmed profile evidence');
END;

CREATE TRIGGER health_summary_evidence_newness_required
BEFORE INSERT ON health_summary_evidence
WHEN (
  (
    (SELECT previous_summary_id
       FROM health_summaries
      WHERE family_id = NEW.family_id AND id = NEW.health_summary_id) IS NULL
    AND NEW.is_new_since_previous_summary <> 1
  )
  OR (
    (SELECT previous_summary_id
       FROM health_summaries
      WHERE family_id = NEW.family_id AND id = NEW.health_summary_id) IS NOT NULL
    AND NEW.is_new_since_previous_summary <> CASE
      WHEN EXISTS (
        SELECT 1
          FROM health_summary_evidence previous_evidence
          JOIN health_summaries summary
            ON summary.family_id = previous_evidence.family_id
           AND summary.id = previous_evidence.health_summary_id
         WHERE summary.family_id = NEW.family_id
           AND summary.id = (
             SELECT previous_summary_id
               FROM health_summaries
              WHERE family_id = NEW.family_id AND id = NEW.health_summary_id
           )
           AND previous_evidence.observation_id = NEW.observation_id
      ) THEN 0 ELSE 1 END
  )
)
BEGIN
  SELECT RAISE(ABORT, 'health summary evidence newness is invalid');
END;

CREATE TRIGGER health_summary_evidence_delete_forbidden
BEFORE DELETE ON health_summary_evidence
BEGIN
  SELECT RAISE(ABORT, 'health summary evidence is immutable');
END;
