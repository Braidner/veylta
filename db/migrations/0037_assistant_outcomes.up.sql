-- The outcome log: what the clinician said about a block an assistant proposed — confirmed,
-- rejected or modified — as the person recorded it, dated by them and, when they chose, tied to
-- the confirmed clinician record that documents it. Append-only: the latest mark per block stands
-- and the earlier ones stay, so the log is the person's history, never a rewritten verdict.
CREATE TABLE assistant_outcomes (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  patient_profile_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL CHECK (assistant_id IN ('physician', 'nutritionist', 'trainer')),
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  block_index INTEGER NOT NULL CHECK (block_index >= 0),
  block_kind TEXT NOT NULL CHECK (
    block_kind IN (
      'hypothesis', 'treatment_option', 'diet_recommendation', 'activity_recommendation',
      'clinician_check'
    )
  ),
  -- The block's own name or the сверка's position, so the log lists a mark without reparsing.
  block_title TEXT NOT NULL CHECK (length(block_title) BETWEEN 1 AND 200),
  verdict TEXT NOT NULL CHECK (verdict IN ('confirmed', 'rejected', 'modified')),
  decided_on TEXT CHECK (
    decided_on IS NULL
    OR (
      length(decided_on) = 10
      AND decided_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND date(decided_on) = decided_on
    )
  ),
  note TEXT CHECK (note IS NULL OR (length(note) BETWEEN 1 AND 500 AND note = trim(note))),
  clinician_record_id TEXT,
  recorded_by_user_id TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  FOREIGN KEY (family_id, conversation_id)
    REFERENCES assistant_conversations(family_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (family_id, message_id)
    REFERENCES assistant_messages(family_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (family_id, clinician_record_id)
    REFERENCES clinician_records(family_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (family_id, recorded_by_user_id)
    REFERENCES family_memberships(family_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX assistant_outcomes_room
  ON assistant_outcomes (family_id, patient_profile_id, assistant_id, recorded_at DESC);

CREATE INDEX assistant_outcomes_message
  ON assistant_outcomes (family_id, message_id, block_index, recorded_at DESC);

-- A mark is a record of what a person wrote down; it is never edited or erased in place.
CREATE TRIGGER assistant_outcomes_update_forbidden
BEFORE UPDATE ON assistant_outcomes
BEGIN
  SELECT RAISE(ABORT, 'assistant outcomes are immutable');
END;

CREATE TRIGGER assistant_outcomes_delete_forbidden
BEFORE DELETE ON assistant_outcomes
BEGIN
  SELECT RAISE(ABORT, 'assistant outcomes are immutable');
END;
