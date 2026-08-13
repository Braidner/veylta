CREATE TABLE profile_consent_grants (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  patient_profile_id TEXT NOT NULL,
  grantee_user_id TEXT NOT NULL,
  granted_by_user_id TEXT NOT NULL,
  capability TEXT NOT NULL CHECK (capability = 'profile.read'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  UNIQUE (family_id, id),
  FOREIGN KEY (family_id, patient_profile_id)
    REFERENCES patient_profiles(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, grantee_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, granted_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT profile_consent_grants_revoked_at_check CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE UNIQUE INDEX profile_consent_grants_one_active_capability
  ON profile_consent_grants (family_id, patient_profile_id, grantee_user_id, capability)
  WHERE revoked_at IS NULL;

CREATE INDEX profile_consent_grants_grantee_active
  ON profile_consent_grants (family_id, grantee_user_id, patient_profile_id)
  WHERE revoked_at IS NULL;

CREATE TRIGGER profile_consent_grants_owner_issuer
BEFORE INSERT ON profile_consent_grants
WHEN NOT EXISTS (
  SELECT 1
    FROM family_memberships
   WHERE family_id = NEW.family_id
     AND user_id = NEW.granted_by_user_id
     AND role = 'owner'
     AND status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'profile consent grant issuer must be an active owner');
END;

CREATE TRIGGER profile_consent_grants_active_adult_grantee
BEFORE INSERT ON profile_consent_grants
WHEN NOT EXISTS (
  SELECT 1
    FROM family_memberships
   WHERE family_id = NEW.family_id
     AND user_id = NEW.grantee_user_id
     AND role = 'adult_member'
     AND status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'profile consent grantee must be an active adult member');
END;

CREATE TRIGGER profile_consent_grants_immutable_fields
BEFORE UPDATE ON profile_consent_grants
WHEN NEW.family_id IS NOT OLD.family_id
  OR NEW.patient_profile_id IS NOT OLD.patient_profile_id
  OR NEW.grantee_user_id IS NOT OLD.grantee_user_id
  OR NEW.granted_by_user_id IS NOT OLD.granted_by_user_id
  OR NEW.capability IS NOT OLD.capability
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'profile consent grant identity is immutable');
END;

CREATE TRIGGER profile_consent_grants_revocation_immutable
BEFORE UPDATE ON profile_consent_grants
WHEN OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'profile consent grant was already revoked');
END;
