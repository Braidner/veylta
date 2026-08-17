CREATE TABLE assistant_exchanges_0030 (
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

-- Opinion and synthesis exchanges have no place in the older shape and are dropped with it.
INSERT INTO assistant_exchanges_0030
  (id, family_id, conversation_id, message_id, stage, model_id, runtime_version,
   request_bytes, response_bytes, request_text, response_text, duration_ms, created_at)
SELECT id, family_id, conversation_id, message_id, stage, model_id, runtime_version,
       request_bytes, response_bytes, request_text, response_text, duration_ms, created_at
  FROM assistant_exchanges
 WHERE stage IN ('answer', 'checker');

DROP TRIGGER IF EXISTS assistant_exchanges_update_forbidden;
DROP TRIGGER IF EXISTS assistant_exchanges_delete_forbidden;
DROP INDEX IF EXISTS assistant_exchanges_message_stage;
DROP TABLE assistant_exchanges;
ALTER TABLE assistant_exchanges_0030 RENAME TO assistant_exchanges;

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

ALTER TABLE assistant_messages DROP COLUMN consilium_json;
ALTER TABLE assistant_messages DROP COLUMN speaker;
ALTER TABLE assistant_messages DROP COLUMN addressee;
