-- Document analysis may run on its own model. A separate model has its own usage window in
-- Codex, so a household can keep dialogues on one model and send extraction to another
-- without the two competing for one quota. NULL means "the same model as dialogues".
ALTER TABLE codex_preferences
  ADD COLUMN document_model_id TEXT CHECK (
    document_model_id IS NULL
    OR (
      length(document_model_id) BETWEEN 2 AND 80
      AND document_model_id = trim(document_model_id)
      AND document_model_id NOT GLOB '*[^A-Za-z0-9._-]*'
    )
  );
