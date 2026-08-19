-- A profile's handle is its browser-facing name: `/<handle>` is the person's page. Unique across
-- the server (the address carries no family), lower-case latin, 3–30 characters. Existing rows get
-- a provisional `p-<hex>` handle here; `pnpm db:migrate` then rewrites provisional handles by the
-- default rule (username, then name) in code — see apps/api/src/family/patient-profiles.ts.
ALTER TABLE patient_profiles ADD COLUMN handle TEXT COLLATE NOCASE CHECK (
  handle IS NULL
  OR (
    length(handle) BETWEEN 3 AND 30
    -- `handle = lower(handle)` is inert under COLLATE NOCASE (SQLite compares it case-insensitively
    -- either way); the GLOB clauses below are what actually forbid an upper-case character.
    AND handle = lower(handle)
    AND handle GLOB '[a-z0-9]*'
    AND handle NOT GLOB '*[^a-z0-9-]*'
    AND handle NOT GLOB '*-'
  )
);
ALTER TABLE patient_profiles ADD COLUMN handle_set_by TEXT NOT NULL DEFAULT 'auto' CHECK (
  handle_set_by IN ('auto', 'person')
);

UPDATE patient_profiles
   SET handle = 'p-' || lower(substr(replace(id, '-', ''), 1, 12))
 WHERE handle IS NULL;

CREATE UNIQUE INDEX patient_profiles_handle_unique
  ON patient_profiles (handle COLLATE NOCASE);
