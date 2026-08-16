-- Document analysis is transcription under a strict schema: codes come from the catalog and
-- range membership is computed server-side, so it needs far less reasoning than a dialogue.
-- A separate effort lets a household run extraction fast while keeping deep reasoning for
-- conversations and care-plan proposals. Existing rows keep dialogue effort and gain 'low'.
ALTER TABLE codex_preferences
  ADD COLUMN document_reasoning_effort TEXT NOT NULL DEFAULT 'low' CHECK (
    document_reasoning_effort IN ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  );
