-- The консилиум (docs/assistants.md, slice 2): a user message may address one specialist
-- persona, an assistant message may be spoken by that persona, and the therapist's synthesis
-- carries the whole консилиум — invitations, verified opinions, agreements — as one bounded
-- JSON next to its answer. Exchanges gain the opinion and synthesis stages; a persona's runs
-- (its opinion and that opinion's checker) carry the specialty, the therapist's carry none.
ALTER TABLE assistant_messages
  ADD COLUMN addressee TEXT CHECK (
    addressee IS NULL OR (length(addressee) BETWEEN 1 AND 40 AND addressee NOT GLOB '*[^a-z_]*')
  );
ALTER TABLE assistant_messages
  ADD COLUMN speaker TEXT CHECK (
    speaker IS NULL OR (length(speaker) BETWEEN 1 AND 40 AND speaker NOT GLOB '*[^a-z_]*')
  );
ALTER TABLE assistant_messages
  ADD COLUMN consilium_json TEXT CHECK (consilium_json IS NULL OR length(consilium_json) <= 524288);

CREATE TABLE assistant_exchanges_0032 (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('answer', 'checker', 'opinion', 'synthesis')),
  specialty TEXT CHECK (
    specialty IS NULL OR (length(specialty) BETWEEN 1 AND 40 AND specialty NOT GLOB '*[^a-z_]*')
  ),
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
  FOREIGN KEY (family_id, conversation_id, message_id)
    REFERENCES assistant_messages(family_id, conversation_id, id)
    ON DELETE RESTRICT
);

INSERT INTO assistant_exchanges_0032
  (id, family_id, conversation_id, message_id, stage, specialty, model_id, runtime_version,
   request_bytes, response_bytes, request_text, response_text, duration_ms, created_at)
SELECT id, family_id, conversation_id, message_id, stage, NULL, model_id, runtime_version,
       request_bytes, response_bytes, request_text, response_text, duration_ms, created_at
  FROM assistant_exchanges;

DROP TRIGGER IF EXISTS assistant_exchanges_update_forbidden;
DROP TRIGGER IF EXISTS assistant_exchanges_delete_forbidden;
DROP TABLE assistant_exchanges;
ALTER TABLE assistant_exchanges_0032 RENAME TO assistant_exchanges;

CREATE UNIQUE INDEX assistant_exchanges_message_stage
  ON assistant_exchanges (family_id, message_id, stage, coalesce(specialty, ''));

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
