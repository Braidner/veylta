-- The assistants («ИИ-врач» and its checker run) reason over evidence: they get their own
-- effort next to the fast document effort, defaulting high. Existing rows gain 'high'.
ALTER TABLE codex_preferences
  ADD COLUMN assistant_reasoning_effort TEXT NOT NULL DEFAULT 'high' CHECK (
    assistant_reasoning_effort IN ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  );
