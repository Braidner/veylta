CREATE TABLE analyte_catalog (
  canonical_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  canonical_unit TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('system', 'user', 'agent')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT analyte_catalog_code_check CHECK (
    length(canonical_code) BETWEEN 1 AND 100
    AND canonical_code = lower(canonical_code)
    AND canonical_code NOT GLOB '*[^a-z0-9._-]*'
  ),
  CONSTRAINT analyte_catalog_name_check CHECK (
    length(display_name) BETWEEN 1 AND 200
    AND display_name = trim(display_name)
  ),
  CONSTRAINT analyte_catalog_unit_check CHECK (
    length(canonical_unit) BETWEEN 1 AND 100
    AND canonical_unit = trim(canonical_unit)
  )
);

CREATE TABLE analyte_aliases (
  id TEXT PRIMARY KEY,
  canonical_code TEXT NOT NULL REFERENCES analyte_catalog(canonical_code) ON DELETE RESTRICT,
  laboratory_key TEXT NOT NULL DEFAULT '*',
  source_name_key TEXT NOT NULL,
  source_unit_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed')),
  origin TEXT NOT NULL CHECK (origin IN ('system', 'user', 'agent')),
  created_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (laboratory_key, source_name_key, source_unit_key),
  CONSTRAINT analyte_aliases_id_check CHECK (
    length(id) BETWEEN 1 AND 100
    AND id = trim(id)
    AND id NOT GLOB '*[^a-z0-9._-]*'
  ),
  CONSTRAINT analyte_aliases_laboratory_check CHECK (
    laboratory_key = '*'
    OR (
      length(laboratory_key) BETWEEN 1 AND 200
      AND laboratory_key = trim(laboratory_key)
      AND laboratory_key = lower(laboratory_key)
    )
  ),
  CONSTRAINT analyte_aliases_name_check CHECK (
    length(source_name_key) BETWEEN 1 AND 200
    AND source_name_key = trim(source_name_key)
    AND source_name_key = lower(source_name_key)
  ),
  CONSTRAINT analyte_aliases_unit_check CHECK (
    length(source_unit_key) BETWEEN 1 AND 100
    AND source_unit_key = trim(source_unit_key)
    AND source_unit_key = lower(source_unit_key)
  ),
  CONSTRAINT analyte_aliases_actor_check CHECK (
    (origin = 'system' AND created_by_user_id IS NULL)
    OR (origin IN ('user', 'agent') AND created_by_user_id IS NOT NULL)
  )
);

CREATE INDEX analyte_aliases_lookup
  ON analyte_aliases (source_name_key, source_unit_key, laboratory_key, status);

INSERT INTO analyte_catalog
  (canonical_code, display_name, canonical_unit, origin)
VALUES
  ('synthetic-analyte-a', 'Синтетический аналит A', 'synthetic-unit', 'system'),
  ('synthetic-analyte-b', 'Синтетический аналит B', 'synthetic-unit', 'system'),
  ('bilirubin.total', 'Билирубин общий', 'µmol/L', 'system');

INSERT INTO analyte_aliases
  (id, canonical_code, laboratory_key, source_name_key, source_unit_key, status, origin)
VALUES
  ('system.bilirubin-total-ru', 'bilirubin.total', '*', 'билирубин общий', 'umol/l', 'confirmed', 'system'),
  ('system.bilirubin-total-tv', 'bilirubin.total', '*', 'билирубин общий (тв)', 'umol/l', 'confirmed', 'system'),
  ('system.bilirubin-total-tbil', 'bilirubin.total', '*', 'билирубин общий (tbil)', 'umol/l', 'confirmed', 'system'),
  ('system.bilirubin-total-en', 'bilirubin.total', '*', 'total bilirubin', 'umol/l', 'confirmed', 'system');

CREATE TRIGGER analyte_catalog_identity_immutable
BEFORE UPDATE OF canonical_code, origin, created_at ON analyte_catalog
BEGIN
  SELECT RAISE(ABORT, 'analyte catalog identity is immutable');
END;

CREATE TRIGGER analyte_aliases_identity_immutable
BEFORE UPDATE OF
  id,
  canonical_code,
  laboratory_key,
  source_name_key,
  source_unit_key,
  origin,
  created_by_user_id,
  created_at
ON analyte_aliases
BEGIN
  SELECT RAISE(ABORT, 'analyte alias identity is immutable');
END;
