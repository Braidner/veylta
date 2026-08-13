DROP TRIGGER profile_consent_grants_active_adult_grantee;

CREATE TRIGGER profile_consent_grants_active_invited_grantee
BEFORE INSERT ON profile_consent_grants
WHEN NOT EXISTS (
  SELECT 1
    FROM family_memberships
   WHERE family_id = NEW.family_id
     AND user_id = NEW.grantee_user_id
     AND role IN ('adult_member', 'caregiver')
     AND status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'profile consent grantee must be an active invited member');
END;

CREATE TRIGGER patient_profiles_linked_user_must_be_self_managing
BEFORE INSERT ON patient_profiles
WHEN NEW.linked_user_id IS NOT NULL
 AND EXISTS (
   SELECT 1
     FROM family_memberships
    WHERE family_id = NEW.family_id
      AND user_id = NEW.linked_user_id
 )
 AND NOT EXISTS (
   SELECT 1
     FROM family_memberships
    WHERE family_id = NEW.family_id
      AND user_id = NEW.linked_user_id
      AND role IN ('owner', 'adult_member')
      AND status = 'active'
 )
BEGIN
  SELECT RAISE(ABORT, 'linked profile user must be an active owner or adult member');
END;

CREATE TRIGGER patient_profiles_linked_user_update_must_be_self_managing
BEFORE UPDATE OF family_id, linked_user_id ON patient_profiles
WHEN NEW.linked_user_id IS NOT NULL
 AND EXISTS (
   SELECT 1
     FROM family_memberships
    WHERE family_id = NEW.family_id
      AND user_id = NEW.linked_user_id
 )
 AND NOT EXISTS (
   SELECT 1
     FROM family_memberships
    WHERE family_id = NEW.family_id
      AND user_id = NEW.linked_user_id
      AND role IN ('owner', 'adult_member')
      AND status = 'active'
 )
BEGIN
  SELECT RAISE(ABORT, 'linked profile user must be an active owner or adult member');
END;

CREATE TRIGGER family_memberships_linked_user_role_must_be_self_managing
BEFORE UPDATE OF role ON family_memberships
WHEN EXISTS (
  SELECT 1
    FROM patient_profiles
   WHERE family_id = OLD.family_id
     AND linked_user_id = OLD.user_id
)
 AND NEW.role NOT IN ('owner', 'adult_member')
BEGIN
  SELECT RAISE(ABORT, 'linked profile role must remain owner or adult member');
END;

DROP TRIGGER family_invitations_consumption_immutable;
DROP TRIGGER family_invitations_immutable_fields;
DROP TRIGGER family_invitations_owner_issuer;
DROP INDEX family_invitations_pending_token;

CREATE TABLE family_invitations_next (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  issued_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('adult_member', 'caregiver')),
  expires_at TEXT NOT NULL,
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (family_id, id),
  FOREIGN KEY (family_id, issued_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT family_invitations_token_hash_check CHECK (
    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
  ),
  CONSTRAINT family_invitations_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT family_invitations_acceptance_check CHECK (
    (accepted_by_user_id IS NULL AND accepted_at IS NULL)
    OR (accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL AND accepted_at >= created_at)
  )
);

INSERT INTO family_invitations_next
  (id, family_id, issued_by_user_id, token_hash, role, expires_at,
   accepted_by_user_id, accepted_at, created_at)
SELECT id, family_id, issued_by_user_id, token_hash, role, expires_at,
       accepted_by_user_id, accepted_at, created_at
  FROM family_invitations;

DROP TABLE family_invitations;
ALTER TABLE family_invitations_next RENAME TO family_invitations;

CREATE INDEX family_invitations_pending_token
  ON family_invitations (token_hash, expires_at)
  WHERE accepted_at IS NULL;

CREATE TRIGGER family_invitations_owner_issuer
BEFORE INSERT ON family_invitations
WHEN NOT EXISTS (
  SELECT 1
    FROM family_memberships
   WHERE family_id = NEW.family_id
     AND user_id = NEW.issued_by_user_id
     AND role = 'owner'
     AND status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'family invitation issuer must be an active owner');
END;

CREATE TRIGGER family_invitations_immutable_fields
BEFORE UPDATE ON family_invitations
WHEN NEW.family_id IS NOT OLD.family_id
  OR NEW.issued_by_user_id IS NOT OLD.issued_by_user_id
  OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.role IS NOT OLD.role
  OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'family invitation issuance is immutable');
END;

CREATE TRIGGER family_invitations_consumption_immutable
BEFORE UPDATE ON family_invitations
WHEN OLD.accepted_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'family invitation was already consumed');
END;
