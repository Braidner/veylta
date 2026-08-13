CREATE TABLE family_invitations (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  issued_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role = 'adult_member'),
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
