CREATE TABLE document_agent_rollback_guard (
  allowed INTEGER NOT NULL CHECK (allowed = 0)
);

INSERT INTO document_agent_rollback_guard (allowed)
SELECT 1 WHERE EXISTS (SELECT 1 FROM document_agent_conversations);

DROP TABLE document_agent_rollback_guard;

DROP TRIGGER document_agent_conversations_thread_immutable;
DROP TRIGGER document_agent_message_requests_delete_forbidden;
DROP TRIGGER document_agent_message_requests_update_forbidden;
DROP TRIGGER document_agent_messages_delete_forbidden;
DROP TRIGGER document_agent_messages_update_forbidden;
DROP TABLE document_agent_message_requests;
DROP INDEX document_agent_messages_conversation;
DROP TABLE document_agent_messages;
DROP TABLE document_agent_conversations;
