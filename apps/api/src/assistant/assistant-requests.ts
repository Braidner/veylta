import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database/pool.js";
import { DomainConflictError, type SessionActor } from "../family/family-service.js";
import type { ProfileScope } from "../family/profile-access.js";
import type { ConversationRow } from "./assistant-storage.js";
import type { AssistantTurnOutcome } from "./assistant-turn.js";
import type { AssistantEvidence } from "./evidence.js";

export class AssistantIdempotencyConflictError extends DomainConflictError {}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const evidenceHash = (evidence: AssistantEvidence) => sha256(JSON.stringify(evidence));

interface RequestRow {
  request_hash: string;
  conversation_id: string;
}

/**
 * Idempotency, scoped to family + actor: the same key with the same body replays, a different
 * body under a reused key is a conflict. Returns the conversation the first request touched.
 */
export async function replayedConversation(
  client: DatabaseClient,
  table: "assistant_conversation_requests" | "assistant_message_requests",
  scope: ProfileScope,
  actor: SessionActor,
  keyHash: string,
  requestHash: string,
): Promise<string | null> {
  const row = (
    await client.query<RequestRow>(
      `SELECT request_hash, conversation_id FROM ${table}
        WHERE family_id = $1 AND actor_user_id = $2 AND idempotency_key_hash = $3`,
      [scope.familyId, actor.userId, keyHash],
    )
  ).rows[0];
  if (row === undefined) return null;
  if (row.request_hash !== requestHash) throw new AssistantIdempotencyConflictError();
  return row.conversation_id;
}

export async function recordConversationRequest(
  client: DatabaseClient,
  input: {
    scope: ProfileScope;
    actor: SessionActor;
    conversationId: string;
    keyHash: string;
    requestHash: string;
    now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO assistant_conversation_requests
       (id, family_id, actor_user_id, conversation_id, idempotency_key_hash, request_hash,
        created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      input.scope.familyId,
      input.actor.userId,
      input.conversationId,
      input.keyHash,
      input.requestHash,
      input.now,
    ],
  );
}

export async function recordMessageRequest(
  client: DatabaseClient,
  input: {
    scope: ProfileScope;
    actor: SessionActor;
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    keyHash: string;
    requestHash: string;
    now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO assistant_message_requests
       (id, family_id, actor_user_id, conversation_id, user_message_id, assistant_message_id,
        idempotency_key_hash, request_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      input.scope.familyId,
      input.actor.userId,
      input.conversationId,
      input.userMessageId,
      input.assistantMessageId,
      input.keyHash,
      input.requestHash,
      input.now,
    ],
  );
}

/**
 * The first turn that reached the model pins the Codex thread; every turn that delivered the
 * evidence to that thread refreshes its digest so the next follow-up knows whether to re-send
 * it. A turn the therapist's thread never received leaves both untouched.
 */
export async function rememberThread(
  client: DatabaseClient,
  scope: ProfileScope,
  conversation: ConversationRow,
  outcome: AssistantTurnOutcome,
  hash: string,
  now: Date,
): Promise<void> {
  const delivered = outcome.exchanges.some(
    (item) =>
      (item.stage === "answer" || item.stage === "synthesis") && item.runtimeVersion !== null,
  );
  if (!delivered) {
    await client.query(
      `UPDATE assistant_conversations SET updated_at = $1 WHERE family_id = $2 AND id = $3`,
      [now, scope.familyId, conversation.id],
    );
    return;
  }
  if (conversation.codex_thread_id === null && outcome.threadId !== null) {
    await client.query(
      `UPDATE assistant_conversations
          SET codex_thread_id = $1, model_id = $2, runtime_version = $3, evidence_hash = $4,
              updated_at = $5
        WHERE family_id = $6 AND id = $7 AND codex_thread_id IS NULL`,
      [
        outcome.threadId,
        outcome.modelId,
        outcome.runtimeVersion,
        hash,
        now,
        scope.familyId,
        conversation.id,
      ],
    );
    return;
  }
  await client.query(
    `UPDATE assistant_conversations SET evidence_hash = $1, updated_at = $2
      WHERE family_id = $3 AND id = $4`,
    [hash, now, scope.familyId, conversation.id],
  );
}
