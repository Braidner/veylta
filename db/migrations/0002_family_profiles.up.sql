CREATE TABLE users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CONSTRAINT users_display_name_check CHECK (
    char_length(display_name) BETWEEN 1 AND 120
    AND display_name = btrim(display_name)
  ),
  CONSTRAINT users_disabled_at_check CHECK (
    disabled_at IS NULL OR disabled_at >= created_at
  )
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT sessions_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT sessions_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT sessions_revoked_at_check CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX sessions_active_token
  ON sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE families (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT families_display_name_check CHECK (
    char_length(display_name) BETWEEN 1 AND 120
    AND display_name = btrim(display_name)
  )
);

CREATE TABLE family_memberships (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
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

ALTER TABLE families
  ADD CONSTRAINT families_creator_membership_fk
  FOREIGN KEY (id, created_by_user_id)
  REFERENCES family_memberships(family_id, user_id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE patient_profiles (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  display_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('adult', 'dependent')),
  linked_user_id uuid,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (family_id, id),
  FOREIGN KEY (family_id, created_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, linked_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT patient_profiles_display_name_check CHECK (
    char_length(display_name) BETWEEN 1 AND 120
    AND display_name = btrim(display_name)
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
  id uuid PRIMARY KEY,
  family_id uuid REFERENCES families(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 120),
  resource_type text NOT NULL CHECK (char_length(resource_type) BETWEEN 1 AND 120),
  resource_id uuid NOT NULL,
  result text NOT NULL CHECK (result IN ('success', 'denied', 'failed')),
  correlation_id text NOT NULL CHECK (char_length(correlation_id) BETWEEN 1 AND 200),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT audit_events_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_events_family_time
  ON audit_events (family_id, created_at DESC);

CREATE INDEX audit_events_actor_time
  ON audit_events (actor_user_id, created_at DESC);
