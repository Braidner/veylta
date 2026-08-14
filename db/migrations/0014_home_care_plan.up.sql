CREATE UNIQUE INDEX observations_family_profile_identity
  ON observations (family_id, id, patient_profile_id);

CREATE TABLE care_plan_items (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  patient_profile_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN ('laboratory', 'clinician', 'nutrition', 'activity', 'reminder')
  ),
  title TEXT NOT NULL CHECK (
    length(title) BETWEEN 1 AND 120 AND title = trim(title)
  ),
  note TEXT CHECK (
    note IS NULL OR (length(note) BETWEEN 1 AND 500 AND note = trim(note))
  ),
  scheduled_for TEXT CHECK (
    scheduled_for IS NULL
    OR (
      length(scheduled_for) = 10
      AND scheduled_for GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(scheduled_for) = scheduled_for
    )
  ),
  state TEXT NOT NULL CHECK (state IN ('proposed', 'accepted', 'completed', 'dismissed')),
  origin TEXT NOT NULL CHECK (origin IN ('user', 'codex')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by_user_id TEXT NOT NULL,
  health_summary_id TEXT,
  source_observation_id TEXT,
  rule_version TEXT,
  missing_context TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(missing_context) AND json_type(missing_context) = 'array'
  ),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  UNIQUE (family_id, id, patient_profile_id),
  FOREIGN KEY (family_id, patient_profile_id)
    REFERENCES patient_profiles(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, created_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, health_summary_id, patient_profile_id)
    REFERENCES health_summaries(family_id, id, patient_profile_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, source_observation_id, patient_profile_id)
    REFERENCES observations(family_id, id, patient_profile_id)
    ON DELETE RESTRICT,
  CONSTRAINT care_plan_items_origin_shape_check CHECK (
    (
      origin = 'user'
      AND state IN ('accepted', 'completed', 'dismissed')
      AND health_summary_id IS NULL
      AND source_observation_id IS NULL
      AND rule_version IS NULL
      AND missing_context = '[]'
    )
    OR (
      origin = 'codex'
      AND health_summary_id IS NOT NULL
      AND rule_version IS NOT NULL
      AND length(rule_version) BETWEEN 1 AND 120
    )
  ),
  CONSTRAINT care_plan_items_timestamps_check CHECK (updated_at >= created_at)
);

CREATE INDEX care_plan_items_profile_state_schedule
  ON care_plan_items (family_id, patient_profile_id, state, scheduled_for, created_at DESC);

CREATE UNIQUE INDEX care_plan_items_rule_proposal
  ON care_plan_items (family_id, patient_profile_id, health_summary_id, category, rule_version)
  WHERE origin = 'codex';

CREATE TRIGGER care_plan_items_missing_context_shape_required
BEFORE INSERT ON care_plan_items
WHEN EXISTS (
  SELECT 1
    FROM json_each(NEW.missing_context)
   WHERE type <> 'text'
      OR length(value) NOT BETWEEN 1 AND 120
      OR value GLOB '*[^a-z0-9_]*'
)
 OR json_array_length(NEW.missing_context) <> (
   SELECT count(DISTINCT value) FROM json_each(NEW.missing_context)
 )
BEGIN
  SELECT RAISE(ABORT, 'care plan missing context is invalid');
END;

CREATE TRIGGER care_plan_items_source_in_summary_required
BEFORE INSERT ON care_plan_items
WHEN NEW.origin = 'codex'
 AND NEW.source_observation_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
     FROM health_summary_evidence evidence
    WHERE evidence.family_id = NEW.family_id
      AND evidence.health_summary_id = NEW.health_summary_id
      AND evidence.observation_id = NEW.source_observation_id
 )
BEGIN
  SELECT RAISE(ABORT, 'care plan source must belong to the selected summary');
END;

CREATE TRIGGER care_plan_items_content_immutable
BEFORE UPDATE ON care_plan_items
WHEN NEW.id IS NOT OLD.id
 OR NEW.family_id IS NOT OLD.family_id
 OR NEW.patient_profile_id IS NOT OLD.patient_profile_id
 OR NEW.category IS NOT OLD.category
 OR NEW.title IS NOT OLD.title
 OR NEW.note IS NOT OLD.note
 OR NEW.origin IS NOT OLD.origin
 OR NEW.created_by_user_id IS NOT OLD.created_by_user_id
 OR NEW.health_summary_id IS NOT OLD.health_summary_id
 OR NEW.source_observation_id IS NOT OLD.source_observation_id
 OR NEW.rule_version IS NOT OLD.rule_version
 OR NEW.missing_context IS NOT OLD.missing_context
 OR NEW.created_at IS NOT OLD.created_at
 OR NEW.revision <> OLD.revision + 1
BEGIN
  SELECT RAISE(ABORT, 'care plan source content is immutable');
END;

CREATE TRIGGER care_plan_items_state_transition_required
BEFORE UPDATE ON care_plan_items
WHEN NOT (
  (OLD.state = 'proposed' AND NEW.state IN ('accepted', 'dismissed'))
  OR (OLD.state = 'accepted' AND NEW.state IN ('accepted', 'completed', 'dismissed'))
)
BEGIN
  SELECT RAISE(ABORT, 'care plan state transition is invalid');
END;

CREATE TRIGGER care_plan_items_delete_forbidden
BEFORE DELETE ON care_plan_items
BEGIN
  SELECT RAISE(ABORT, 'care plan items are retained');
END;
