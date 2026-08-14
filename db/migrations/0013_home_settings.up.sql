CREATE TABLE home_storage_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  driver TEXT NOT NULL CHECK (driver IN ('local', 's3')),
  current_root TEXT,
  target_root TEXT,
  state TEXT NOT NULL CHECK (state IN ('stable', 'copying', 'failed')),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
  last_failure_code TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT home_storage_settings_shape_check CHECK (
    (driver = 'local' AND current_root IS NOT NULL AND length(current_root) BETWEEN 2 AND 2048)
    OR (driver = 's3' AND current_root IS NULL)
  ),
  CONSTRAINT home_storage_settings_state_check CHECK (
    (state = 'stable' AND target_root IS NULL AND last_failure_code IS NULL)
    OR (state = 'copying' AND target_root IS NOT NULL AND last_failure_code IS NULL)
    OR (state = 'failed' AND target_root IS NOT NULL AND last_failure_code IS NOT NULL)
  ),
  CONSTRAINT home_storage_settings_failure_code_check CHECK (
    last_failure_code IS NULL
    OR last_failure_code IN ('TARGET_INVALID', 'COPY_FAILED', 'VERIFY_FAILED')
  )
);
