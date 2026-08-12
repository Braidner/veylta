CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  disabled_at TEXT,
  CONSTRAINT users_display_name_check CHECK (
    length(display_name) BETWEEN 1 AND 120
    AND display_name = trim(display_name)
  ),
  CONSTRAINT users_disabled_at_check CHECK (
    disabled_at IS NULL OR disabled_at >= created_at
  )
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  CONSTRAINT sessions_token_hash_check CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT sessions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT sessions_revoked_at_check CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX sessions_active_token
  ON sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE families (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, created_by_user_id),
  CONSTRAINT families_display_name_check CHECK (
    length(display_name) BETWEEN 1 AND 120
    AND display_name = trim(display_name)
  ),
  FOREIGN KEY (id, created_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE NO ACTION
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE family_memberships (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  UNIQUE (family_id, user_id),
  CONSTRAINT family_memberships_role_check CHECK (
    role IN ('owner', 'adult_member', 'caregiver')
  ),
  CONSTRAINT family_memberships_status_value_check CHECK (
    status IN ('active', 'revoked')
  ),
  CONSTRAINT family_memberships_status_check CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT family_memberships_revoked_at_check CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX family_memberships_actor_active
  ON family_memberships (user_id, family_id)
  WHERE status = 'active';

CREATE TABLE patient_profiles (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('adult', 'dependent')),
  linked_user_id TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  UNIQUE (family_id, id),
  FOREIGN KEY (family_id, created_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, linked_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT patient_profiles_display_name_check CHECK (
    length(display_name) BETWEEN 1 AND 120
    AND display_name = trim(display_name)
  ),
  CONSTRAINT patient_profiles_linked_user_kind_check CHECK (
    kind = 'adult' OR linked_user_id IS NULL
  ),
  CONSTRAINT patient_profiles_archived_at_check CHECK (
    archived_at IS NULL OR archived_at >= created_at
  )
);

CREATE UNIQUE INDEX patient_profiles_active_linked_user
  ON patient_profiles (family_id, linked_user_id)
  WHERE linked_user_id IS NOT NULL AND archived_at IS NULL;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  family_id TEXT REFERENCES families(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 120),
  resource_type TEXT NOT NULL CHECK (length(resource_type) BETWEEN 1 AND 120),
  resource_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'denied', 'failed')),
  correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 200),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT audit_events_metadata_object_check CHECK (
    json_valid(metadata) AND json_type(metadata) = 'object'
  )
);

CREATE INDEX audit_events_family_time
  ON audit_events (family_id, created_at DESC);

CREATE INDEX audit_events_actor_time
  ON audit_events (actor_user_id, created_at DESC);
