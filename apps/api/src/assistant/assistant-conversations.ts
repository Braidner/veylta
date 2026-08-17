import { randomUUID } from "node:crypto";
import {
  type AssistantConversationPurpose,
  type AssistantId,
  type AssistantWorkspaceResponse,
  MAX_ASSISTANT_CONVERSATIONS,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import { DomainConflictError, type SessionActor } from "../family/family-service.js";
import { type ProfileScope, requireProfileWrite } from "../family/profile-access.js";
import { recordConversationRequest, replayedConversation, sha256 } from "./assistant-requests.js";
import { audit, workspaceResponse } from "./assistant-storage.js";

/**
 * A new conversation under an idempotency key: replayed by key, capped per profile. With a
 * purpose (the dossier's «Досье · Кардиолог») the existing conversation of that purpose is
 * returned instead — the person's questions to one doctor stay in one place.
 */
export async function createAssistantConversation(
  client: DatabaseClient,
  input: {
    actor: SessionActor;
    scope: ProfileScope;
    assistantId: AssistantId;
    title: string;
    purpose: AssistantConversationPurpose | null;
    key: string;
    correlationId: string;
  },
): Promise<{ response: AssistantWorkspaceResponse; replayed: boolean }> {
  const { actor, scope, assistantId, title, purpose, key, correlationId } = input;
  await requireProfileWrite(client, actor, scope);
  const keyHash = sha256(key);
  const requestHash = sha256(JSON.stringify({ profileId: scope.profileId, title, purpose }));
  const table = "assistant_conversation_requests";
  const replay = await replayedConversation(client, table, scope, actor, keyHash, requestHash);
  if (replay !== null) {
    const response = await workspaceResponse(client, scope, assistantId, true, replay);
    return { response, replayed: true };
  }
  if (purpose !== null) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM assistant_conversations
          WHERE family_id = $1 AND patient_profile_id = $2 AND assistant_id = $3 AND purpose = $4`,
      [scope.familyId, scope.profileId, assistantId, purpose],
    );
    const found = existing.rows[0]?.id;
    if (found !== undefined) {
      const response = await workspaceResponse(client, scope, assistantId, true, found);
      return { response, replayed: true };
    }
  }
  const count = await client.query<{ value: number }>(
    `SELECT count(*) AS value FROM assistant_conversations
        WHERE family_id = $1 AND patient_profile_id = $2 AND assistant_id = $3`,
    [scope.familyId, scope.profileId, assistantId],
  );
  if ((count.rows[0]?.value ?? 0) >= MAX_ASSISTANT_CONVERSATIONS) {
    throw new DomainConflictError();
  }
  const conversationId = randomUUID();
  const now = new Date();
  await client.query(
    `INSERT INTO assistant_conversations
         (id, family_id, patient_profile_id, assistant_id, created_by_user_id, title, purpose,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      conversationId,
      scope.familyId,
      scope.profileId,
      assistantId,
      actor.userId,
      title,
      purpose,
      now,
    ],
  );
  await recordConversationRequest(client, {
    scope,
    actor,
    conversationId,
    keyHash,
    requestHash,
    now,
  });
  await audit(client, {
    actor,
    scope,
    action: "profile.assistant.conversation_created",
    resourceId: conversationId,
    correlationId,
    now,
  });
  const response = await workspaceResponse(client, scope, assistantId, true, conversationId);
  return { response, replayed: false };
}
