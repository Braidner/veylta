-- The second-opinion assistants (docs/assistants.md): profile-scoped Codex conversations whose
-- answers are typed, evidence-bound blocks. Shape follows document_agent_* — a conversation
-- owns a resumable Codex thread; messages and requests are immutable; exchanges keep the raw
-- turn for the owner exactly like processing_job_exchanges, and nothing here reaches audit.
CREATE TABLE assistant_conversations (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  patient_profile_id TEXT NOT NULL,
  assistant_id TEXT NOT NULL CHECK (assistant_id IN ('physician')),
  created_by_user_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80 AND title = trim(title)),
  codex_thread_id TEXT CHECK (
    codex_thread_id IS NULL
    OR (length(codex_thread_id) = 36 AND codex_thread_id NOT GLOB '*[^0-9a-f-]*')
  ),
  model_id TEXT CHECK (
    model_id IS NULL OR (length(model_id) BETWEEN 1 AND 100 AND model_id = trim(model_id))
  ),
  runtime_version TEXT CHECK (
    runtime_version IS NULL
    OR (length(runtime_version) BETWEEN 1 AND 100 AND runtime_version = trim(runtime_version))
  ),
  -- Digest of the evidence last sent into the thread; a follow-up re-sends it when it changed.
  evidence_hash TEXT CHECK (
    evidence_hash IS NULL
    OR (length(evidence_hash) = 64 AND evidence_hash NOT GLOB '*[^0-9a-f]*')
  ),
  -- The egress disclosure: no evidence leaves the machine before a member confirmed it here.
  acknowledged_at TEXT,
  acknowledged_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  FOREIGN KEY (family_id, patient_profile_id)
    REFERENCES patient_profiles(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, created_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, acknowledged_by_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT assistant_conversation_thread_shape CHECK (
    (codex_thread_id IS NULL AND model_id IS NULL AND runtime_version IS NULL)
    OR (codex_thread_id IS NOT NULL AND model_id IS NOT NULL AND runtime_version IS NOT NULL)
  ),
  CONSTRAINT assistant_conversation_acknowledgement_shape CHECK (
    (acknowledged_at IS NULL AND acknowledged_by_user_id IS NULL)
    OR (acknowledged_at IS NOT NULL AND acknowledged_by_user_id IS NOT NULL)
  )
);

CREATE INDEX assistant_conversations_profile
  ON assistant_conversations (family_id, patient_profile_id, assistant_id, updated_at DESC);

CREATE TABLE assistant_messages (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  actor_user_id TEXT,
  text TEXT CHECK (text IS NULL OR (length(text) BETWEEN 1 AND 2000 AND text = trim(text))),
  -- The verified answer as the parser and checker left it; NULL when the turn was refused.
  answer_json TEXT CHECK (answer_json IS NULL OR length(answer_json) <= 131072),
  urgency_tier TEXT CHECK (
    urgency_tier IS NULL OR urgency_tier IN ('none', 'routine', 'soon', 'urgent', 'emergency')
  ),
  refusal_reason TEXT CHECK (
    refusal_reason IS NULL
    OR refusal_reason IN (
      'schema_shape',
      'not_russian',
      'unbound_reference',
      'missing_urgency',
      'prescriptive_dose',
      'general_names_values',
      'checker_unsafe',
      'profile_not_ready',
      'response_too_large',
      'provider_unavailable'
    )
  ),
  checker_json TEXT NOT NULL DEFAULT '[]' CHECK (length(checker_json) <= 32768),
  model_id TEXT,
  runtime_version TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  UNIQUE (family_id, conversation_id, id),
  UNIQUE (family_id, conversation_id, sequence),
  FOREIGN KEY (family_id, conversation_id)
    REFERENCES assistant_conversations(family_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT assistant_message_role_shape CHECK (
    (
      role = 'user'
      AND actor_user_id IS NOT NULL
      AND text IS NOT NULL
      AND answer_json IS NULL
      AND urgency_tier IS NULL
      AND refusal_reason IS NULL
      AND model_id IS NULL
      AND runtime_version IS NULL
    )
    OR (
      role = 'assistant'
      AND actor_user_id IS NULL
      AND text IS NULL
      AND model_id IS NOT NULL
      AND length(model_id) BETWEEN 1 AND 100
      AND model_id = trim(model_id)
      AND runtime_version IS NOT NULL
      AND length(runtime_version) BETWEEN 1 AND 100
      AND runtime_version = trim(runtime_version)
      AND (
        (answer_json IS NOT NULL AND urgency_tier IS NOT NULL AND refusal_reason IS NULL)
        OR (answer_json IS NULL AND urgency_tier IS NULL AND refusal_reason IS NOT NULL)
      )
    )
  )
);

CREATE INDEX assistant_messages_conversation
  ON assistant_messages (family_id, conversation_id, sequence);

-- One raw Codex attempt behind an assistant message: the answer run and the checker run. A
-- deliberate exception to the payload-free rule, reachable only through profile authorization.
CREATE TABLE assistant_exchanges (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('answer', 'checker')),
  model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 100 AND model_id = trim(model_id)),
  runtime_version TEXT CHECK (
    runtime_version IS NULL
    OR (length(runtime_version) BETWEEN 1 AND 100 AND runtime_version = trim(runtime_version))
  ),
  request_bytes INTEGER NOT NULL CHECK (request_bytes >= 0),
  response_bytes INTEGER NOT NULL CHECK (response_bytes >= 0),
  request_text TEXT NOT NULL CHECK (length(request_text) <= 262144),
  response_text TEXT NOT NULL CHECK (length(response_text) <= 131072),
  duration_ms INTEGER NOT NULL CHECK (duration_ms BETWEEN 0 AND 86400000),
  created_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  UNIQUE (family_id, message_id, stage),
  FOREIGN KEY (family_id, conversation_id, message_id)
    REFERENCES assistant_messages(family_id, conversation_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE assistant_conversation_requests (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (
    length(idempotency_key_hash) = 64 AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*'
  ),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  UNIQUE (family_id, actor_user_id, idempotency_key_hash),
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, conversation_id)
    REFERENCES assistant_conversations(family_id, id)
    ON DELETE RESTRICT
);

CREATE TABLE assistant_message_requests (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT NOT NULL,
  idempotency_key_hash TEXT NOT NULL CHECK (
    length(idempotency_key_hash) = 64 AND idempotency_key_hash NOT GLOB '*[^0-9a-f]*'
  ),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL,
  UNIQUE (family_id, id),
  UNIQUE (family_id, actor_user_id, idempotency_key_hash),
  FOREIGN KEY (family_id, actor_user_id)
    REFERENCES family_memberships(family_id, user_id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, conversation_id, user_message_id)
    REFERENCES assistant_messages(family_id, conversation_id, id)
    ON DELETE RESTRICT,
  FOREIGN KEY (family_id, conversation_id, assistant_message_id)
    REFERENCES assistant_messages(family_id, conversation_id, id)
    ON DELETE RESTRICT
);

CREATE TRIGGER assistant_conversations_identity_immutable
BEFORE UPDATE OF id, family_id, patient_profile_id, assistant_id, created_by_user_id, created_at
ON assistant_conversations
BEGIN
  SELECT RAISE(ABORT, 'assistant conversation identity is immutable');
END;

CREATE TRIGGER assistant_messages_update_forbidden
BEFORE UPDATE ON assistant_messages
BEGIN
  SELECT RAISE(ABORT, 'assistant messages are immutable');
END;

CREATE TRIGGER assistant_messages_delete_forbidden
BEFORE DELETE ON assistant_messages
BEGIN
  SELECT RAISE(ABORT, 'assistant messages are immutable');
END;

CREATE TRIGGER assistant_exchanges_update_forbidden
BEFORE UPDATE ON assistant_exchanges
BEGIN
  SELECT RAISE(ABORT, 'assistant exchanges are immutable');
END;

CREATE TRIGGER assistant_exchanges_delete_forbidden
BEFORE DELETE ON assistant_exchanges
BEGIN
  SELECT RAISE(ABORT, 'assistant exchanges are immutable');
END;

CREATE TRIGGER assistant_message_requests_update_forbidden
BEFORE UPDATE ON assistant_message_requests
BEGIN
  SELECT RAISE(ABORT, 'assistant requests are immutable');
END;

CREATE TRIGGER assistant_conversation_requests_update_forbidden
BEFORE UPDATE ON assistant_conversation_requests
BEGIN
  SELECT RAISE(ABORT, 'assistant requests are immutable');
END;
