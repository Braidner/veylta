CREATE TABLE document_agent_conversations (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  patient_profile_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  codex_thread_id TEXT,
  model_id TEXT,
  runtime_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  UNIQUE (family_id, document_id),
  FOREIGN KEY (family_id, patient_profile_id)
    REFERENCES patient_profiles(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, document_id, document_version_id)
    REFERENCES document_versions(family_id, document_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, created_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT document_agent_thread_shape CHECK (
    (codex_thread_id IS NULL AND model_id IS NULL AND runtime_version IS NULL)
    OR (
      codex_thread_id IS NOT NULL
      AND length(codex_thread_id) = 36
      AND codex_thread_id = lower(codex_thread_id)
      AND model_id IS NOT NULL
      AND length(model_id) BETWEEN 1 AND 100
      AND model_id = trim(model_id)
      AND runtime_version IS NOT NULL
      AND length(runtime_version) BETWEEN 1 AND 100
      AND runtime_version = trim(runtime_version)
    )
  )
);

CREATE TABLE document_agent_messages (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  actor_user_id TEXT,
  text TEXT NOT NULL CHECK (
    length(text) BETWEEN 1 AND 2000
    AND text = trim(text)
  ),
  model_id TEXT,
  runtime_version TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  UNIQUE (family_id, conversation_id, id),
  UNIQUE (family_id, conversation_id, sequence),
  FOREIGN KEY (family_id, conversation_id)
    REFERENCES document_agent_conversations(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT document_agent_message_role_shape CHECK (
    (
      role = 'user'
      AND actor_user_id IS NOT NULL
      AND model_id IS NULL
      AND runtime_version IS NULL
    )
    OR (
      role = 'assistant'
      AND actor_user_id IS NULL
      AND model_id IS NOT NULL
      AND length(model_id) BETWEEN 1 AND 100
      AND model_id = trim(model_id)
      AND runtime_version IS NOT NULL
      AND length(runtime_version) BETWEEN 1 AND 100
      AND runtime_version = trim(runtime_version)
    )
  )
);

CREATE INDEX document_agent_messages_conversation
  ON document_agent_messages (family_id, conversation_id, sequence);

CREATE TABLE document_agent_message_requests (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (
    length(idempotency_key_hash) = 64
    AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*'
  ),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 64
    AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  UNIQUE (family_id, actor_user_id, idempotency_key_hash),
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, conversation_id, user_message_id)
    REFERENCES document_agent_messages(family_id, conversation_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, conversation_id, assistant_message_id)
    REFERENCES document_agent_messages(family_id, conversation_id, id)
    ON DELETE RESTRICT
);

CREATE TRIGGER document_agent_messages_update_forbidden
BEFORE UPDATE ON document_agent_messages
BEGIN
  SELECT RAISE(ABORT, 'document agent messages are immutable');
END;

CREATE TRIGGER document_agent_messages_delete_forbidden
BEFORE DELETE ON document_agent_messages
BEGIN
  SELECT RAISE(ABORT, 'document agent messages are immutable');
END;

CREATE TRIGGER document_agent_message_requests_update_forbidden
BEFORE UPDATE ON document_agent_message_requests
BEGIN
  SELECT RAISE(ABORT, 'document agent requests are immutable');
END;

CREATE TRIGGER document_agent_message_requests_delete_forbidden
BEFORE DELETE ON document_agent_message_requests
BEGIN
  SELECT RAISE(ABORT, 'document agent requests are immutable');
END;

CREATE TRIGGER document_agent_conversations_thread_immutable
BEFORE UPDATE ON document_agent_conversations
WHEN OLD.codex_thread_id IS NOT NULL AND (
  NEW.codex_thread_id IS NOT OLD.codex_thread_id
  OR NEW.model_id IS NOT OLD.model_id
  OR NEW.runtime_version IS NOT OLD.runtime_version
)
BEGIN
  SELECT RAISE(ABORT, 'document agent thread provenance is immutable');
END;
