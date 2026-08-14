CREATE TABLE codex_preferences (
  id TEXT PRIMARY KEY CHECK (id = 'primary'),
  model_id TEXT NOT NULL CHECK (
    length(model_id) BETWEEN 2 AND 80
    AND model_id = trim(model_id)
    AND model_id NOT GLOB '*[^A-Za-z0-9._-]*'
  ),
  reasoning_effort TEXT NOT NULL CHECK (
    reasoning_effort IN ('low', 'medium', 'high', 'xhigh', 'max', 'ultra')
  ),
  service_tier TEXT NOT NULL CHECK (service_tier IN ('standard', 'fast')),
  updated_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL CHECK (
    length(created_at) = 24
    AND substr(created_at, 11, 1) = 'T'
    AND substr(created_at, 24, 1) = 'Z'
  ),
  updated_at TEXT NOT NULL CHECK (
    length(updated_at) = 24
    AND substr(updated_at, 11, 1) = 'T'
    AND substr(updated_at, 24, 1) = 'Z'
  )
);
