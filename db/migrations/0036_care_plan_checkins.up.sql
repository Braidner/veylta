-- The person's own check-ins on the regimen lanes of the care plan: one mark per accepted
-- activity or nutrition item and calendar day — done or skipped, with a note in their own words.
-- A later mark for the same day replaces the earlier (the diary is the person's to correct);
-- the assistants read the last weeks of marks to build progression on what was actually done.
CREATE TABLE care_plan_item_checkins (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  patient_profile_id TEXT NOT NULL,
  care_plan_item_id TEXT NOT NULL,
  checkin_date TEXT NOT NULL CHECK (
    length(checkin_date) = 10
    AND checkin_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND date(checkin_date) = checkin_date
  ),
  status TEXT NOT NULL CHECK (status IN ('done', 'skipped')),
  note TEXT CHECK (note IS NULL OR (length(note) BETWEEN 1 AND 200 AND note = trim(note))),
  recorded_by_user_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (family_id, care_plan_item_id, checkin_date),
  FOREIGN KEY (family_id, care_plan_item_id, patient_profile_id)
    REFERENCES care_plan_items(family_id, id, patient_profile_id) ON DELETE RESTRICT,
  FOREIGN KEY (family_id, recorded_by_user_id)
    REFERENCES family_memberships(family_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX care_plan_item_checkins_profile
  ON care_plan_item_checkins (family_id, patient_profile_id, checkin_date DESC);
