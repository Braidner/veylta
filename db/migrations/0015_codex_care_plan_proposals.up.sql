CREATE TABLE care_plan_codex_legacy_guard (
  allowed INTEGER NOT NULL CHECK (allowed = 1)
);

INSERT INTO care_plan_codex_legacy_guard (allowed)
SELECT 0 WHERE EXISTS (SELECT 1 FROM care_plan_items WHERE origin = 'codex');

DROP TABLE care_plan_codex_legacy_guard;

CREATE TABLE care_plan_proposal_runs (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  patient_profile_id TEXT NOT NULL,
  health_summary_id TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL,
  model_id TEXT NOT NULL CHECK (
    length(model_id) BETWEEN 2 AND 80
    AND model_id = trim(model_id)
    AND model_id NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  runtime_version TEXT CHECK (
    runtime_version IS NULL
    OR (length(runtime_version) BETWEEN 1 AND 120 AND runtime_version = trim(runtime_version))
  ),
  rule_version TEXT NOT NULL CHECK (
    length(rule_version) BETWEEN 1 AND 120 AND rule_version = trim(rule_version)
  ),
  state TEXT NOT NULL CHECK (state IN ('generating', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  lease_expires_at TEXT,
  failure_code TEXT CHECK (
    failure_code IS NULL
    OR failure_code IN ('CODEX_UNAVAILABLE', 'OUTPUT_INVALID', 'SUMMARY_CHANGED')
  ),
  proposal_count INTEGER CHECK (proposal_count BETWEEN 0 AND 5),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (family_id, id),
  UNIQUE (family_id, id, patient_profile_id),
  UNIQUE (family_id, patient_profile_id, health_summary_id, model_id, rule_version),
  FOREIGN KEY (family_id, patient_profile_id)
    REFERENCES patient_profiles(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, health_summary_id, patient_profile_id)
    REFERENCES health_summaries(family_id, id, patient_profile_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, requested_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT care_plan_proposal_runs_state_shape_check CHECK (
    (
      state = 'generating'
      AND lease_expires_at IS NOT NULL
      AND failure_code IS NULL
      AND runtime_version IS NULL
      AND proposal_count IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'completed'
      AND lease_expires_at IS NULL
      AND failure_code IS NULL
      AND runtime_version IS NOT NULL
      AND proposal_count IS NOT NULL
      AND completed_at IS NOT NULL
    )
    OR (
      state = 'failed'
      AND lease_expires_at IS NULL
      AND failure_code IS NOT NULL
      AND runtime_version IS NULL
      AND proposal_count IS NULL
      AND completed_at IS NULL
    )
  ),
  CONSTRAINT care_plan_proposal_runs_timestamps_check CHECK (
    updated_at >= created_at AND (completed_at IS NULL OR completed_at >= created_at)
  )
);

CREATE INDEX care_plan_proposal_runs_profile_state
  ON care_plan_proposal_runs (family_id, patient_profile_id, state, updated_at DESC);

DROP INDEX care_plan_items_rule_proposal;

CREATE TABLE care_plan_codex_provenance (
  family_id TEXT NOT NULL,
  patient_profile_id TEXT NOT NULL,
  care_plan_item_id TEXT NOT NULL,
  proposal_run_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('laboratory', 'clinician', 'nutrition', 'activity', 'reminder')
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (family_id, care_plan_item_id),
  UNIQUE (family_id, care_plan_item_id, patient_profile_id),
  UNIQUE (family_id, proposal_run_id, category),
  FOREIGN KEY (family_id, care_plan_item_id, patient_profile_id)
    REFERENCES care_plan_items(family_id, id, patient_profile_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (family_id, proposal_run_id, patient_profile_id)
    REFERENCES care_plan_proposal_runs(family_id, id, patient_profile_id)
    ON DELETE RESTRICT
);

CREATE TRIGGER care_plan_codex_provenance_run_required
BEFORE INSERT ON care_plan_codex_provenance
WHEN EXISTS (
  SELECT 1
    FROM care_plan_items item
   WHERE item.family_id = NEW.family_id
     AND item.patient_profile_id = NEW.patient_profile_id
     AND item.id = NEW.care_plan_item_id
)
 OR NOT EXISTS (
  SELECT 1
    FROM care_plan_proposal_runs run
   WHERE run.family_id = NEW.family_id
     AND run.patient_profile_id = NEW.patient_profile_id
     AND run.id = NEW.proposal_run_id
     AND run.state = 'generating'
)
BEGIN
  SELECT RAISE(ABORT, 'care plan proposal run is unavailable');
END;

CREATE TRIGGER care_plan_codex_item_provenance_required
BEFORE INSERT ON care_plan_items
WHEN NEW.origin = 'codex'
 AND NOT EXISTS (
   SELECT 1
     FROM care_plan_codex_provenance provenance
     JOIN care_plan_proposal_runs run
       ON run.family_id = provenance.family_id
      AND run.patient_profile_id = provenance.patient_profile_id
      AND run.id = provenance.proposal_run_id
    WHERE provenance.family_id = NEW.family_id
      AND provenance.patient_profile_id = NEW.patient_profile_id
      AND provenance.care_plan_item_id = NEW.id
      AND provenance.category = NEW.category
      AND run.state = 'generating'
      AND run.health_summary_id = NEW.health_summary_id
      AND run.requested_by_user_id = NEW.created_by_user_id
      AND run.rule_version = NEW.rule_version
 )
BEGIN
  SELECT RAISE(ABORT, 'codex care plan provenance is required');
END;

CREATE TRIGGER care_plan_codex_provenance_update_forbidden
BEFORE UPDATE ON care_plan_codex_provenance
BEGIN
  SELECT RAISE(ABORT, 'codex care plan provenance is immutable');
END;

CREATE TRIGGER care_plan_codex_provenance_delete_forbidden
BEFORE DELETE ON care_plan_codex_provenance
BEGIN
  SELECT RAISE(ABORT, 'codex care plan provenance is retained');
END;

CREATE TRIGGER care_plan_proposal_runs_completed_immutable
BEFORE UPDATE ON care_plan_proposal_runs
WHEN OLD.state = 'completed'
BEGIN
  SELECT RAISE(ABORT, 'completed care plan proposal runs are immutable');
END;

CREATE TRIGGER care_plan_proposal_runs_identity_immutable
BEFORE UPDATE ON care_plan_proposal_runs
WHEN NEW.id IS NOT OLD.id
 OR NEW.family_id IS NOT OLD.family_id
 OR NEW.patient_profile_id IS NOT OLD.patient_profile_id
 OR NEW.health_summary_id IS NOT OLD.health_summary_id
 OR NEW.requested_by_user_id IS NOT OLD.requested_by_user_id
 OR NEW.model_id IS NOT OLD.model_id
 OR NEW.rule_version IS NOT OLD.rule_version
 OR NEW.created_at IS NOT OLD.created_at
 OR (
   OLD.state = 'failed'
   AND NEW.state = 'generating'
   AND NEW.attempt_count <> OLD.attempt_count + 1
 )
 OR (
   NOT (OLD.state = 'failed' AND NEW.state = 'generating')
   AND NEW.attempt_count <> OLD.attempt_count
 )
BEGIN
  SELECT RAISE(ABORT, 'care plan proposal run identity is immutable');
END;

CREATE TRIGGER care_plan_proposal_runs_count_required
BEFORE UPDATE ON care_plan_proposal_runs
WHEN NEW.state = 'completed'
 AND NEW.proposal_count <> (
   SELECT count(*)
     FROM care_plan_codex_provenance provenance
    WHERE provenance.family_id = NEW.family_id
      AND provenance.patient_profile_id = NEW.patient_profile_id
      AND provenance.proposal_run_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'care plan proposal count is invalid');
END;

CREATE TRIGGER care_plan_proposal_runs_transition_required
BEFORE UPDATE ON care_plan_proposal_runs
WHEN OLD.state <> 'completed'
 AND NOT (
   (OLD.state = 'generating' AND NEW.state IN ('generating', 'completed', 'failed'))
   OR (OLD.state = 'failed' AND NEW.state = 'generating')
 )
BEGIN
  SELECT RAISE(ABORT, 'care plan proposal run transition is invalid');
END;

CREATE TRIGGER care_plan_proposal_runs_delete_forbidden
BEFORE DELETE ON care_plan_proposal_runs
BEGIN
  SELECT RAISE(ABORT, 'care plan proposal runs are retained');
END;
