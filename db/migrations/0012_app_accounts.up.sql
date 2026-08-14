CREATE TABLE app_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT app_accounts_username_check CHECK (
    length(username) BETWEEN 3 AND 32
    AND username = lower(trim(username))
    AND username GLOB '[a-z0-9]*'
    AND username NOT GLOB '*[^a-z0-9._-]*'
  ),
  CONSTRAINT app_accounts_password_hash_check CHECK (
    length(password_hash) BETWEEN 80 AND 200
    AND password_hash GLOB 'scrypt-v1$*'
  ),
  CONSTRAINT app_accounts_updated_at_check CHECK (updated_at >= created_at)
);

CREATE INDEX app_accounts_active_role
  ON app_accounts (role, user_id);
