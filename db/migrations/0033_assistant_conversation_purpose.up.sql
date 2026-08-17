-- The dossier opens conversations with a purpose — one per specialist («dossier:cardiologist»,
-- the therapist for findings no specialty reads) and one консилиум over the whole record
-- («dossier:consilium») — and finds them again instead of creating a new one every time.
ALTER TABLE assistant_conversations
  ADD COLUMN purpose TEXT CHECK (
    purpose IS NULL
    OR (purpose GLOB 'dossier:*' AND length(purpose) BETWEEN 9 AND 40 AND purpose = trim(purpose))
  );

CREATE UNIQUE INDEX assistant_conversations_purpose
  ON assistant_conversations (family_id, patient_profile_id, assistant_id, purpose)
  WHERE purpose IS NOT NULL;
