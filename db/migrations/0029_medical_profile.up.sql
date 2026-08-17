-- What a person records about themselves for the assistants to reason over: user-authored,
-- dated, revisioned. Nothing here is inferred by Veylta or a model. Singleton kinds (sex,
-- birth year, height, weight, pregnancy) hold one active value per profile; archiving keeps the
-- row so history and provenance survive.
CREATE TABLE medical_profile_entries (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  patient_profile_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'sex', 'birth_year', 'height_cm', 'weight_kg', 'pregnancy',
      'condition', 'medication', 'allergy', 'intolerance', 'family_history',
      'symptom', 'goal', 'dietary_restriction', 'activity_constraint', 'clearance', 'note'
    )
  ),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 300 AND value = trim(value)),
  recorded_on TEXT CHECK (
    recorded_on IS NULL
    OR (
      length(recorded_on) = 10
      AND recorded_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(recorded_on) = recorded_on
    )
  ),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  UNIQUE (family_id, id),
  UNIQUE (family_id, id, patient_profile_id),
  FOREIGN KEY (family_id, patient_profile_id)
    REFERENCES patient_profiles(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, created_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT
);

CREATE INDEX medical_profile_entries_profile
  ON medical_profile_entries (family_id, patient_profile_id, archived_at, kind);

CREATE UNIQUE INDEX medical_profile_entries_singleton
  ON medical_profile_entries (family_id, patient_profile_id, kind)
  WHERE archived_at IS NULL
    AND kind IN ('sex', 'birth_year', 'height_cm', 'weight_kg', 'pregnancy');

CREATE TRIGGER medical_profile_entries_identity_immutable
BEFORE UPDATE OF id, family_id, patient_profile_id, kind, created_by_user_id, created_at
ON medical_profile_entries
BEGIN
  SELECT RAISE(ABORT, 'medical profile entry identity is immutable');
END;
