import { randomUUID } from "node:crypto";
import {
  ASSISTANT_EGRESS_ACKNOWLEDGEMENT,
  type AssistantId,
  type AssistantWorkspaceResponse,
  MAX_ASSISTANT_CONVERSATIONS,
  MAX_ASSISTANT_MESSAGE_LENGTH,
} from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import { createSerializer } from "../database/serialized.js";
import {
  DomainConflictError,
  DomainValidationError,
  type SessionActor,
} from "../family/family-service.js";
import {
  canonicalProfileScope,
  type ProfileScope,
  profileAccess,
  requireProfileWrite,
} from "../family/profile-access.js";
import { recordConversationRequest, replayedConversation, sha256 } from "./assistant-requests.js";
import { sendAssistantMessage } from "./assistant-send.js";
import { audit, loadConversation, workspaceResponse } from "./assistant-storage.js";
import type { AssistantRuntime } from "./codex-assistant-runtime.js";

export { AssistantIdempotencyConflictError } from "./assistant-requests.js";
export { AssistantAcknowledgementRequiredError } from "./assistant-send.js";

export interface AssistantService {
  getWorkspace(
    actor: SessionActor,
    scope: ProfileScope,
    assistantId: AssistantId,
    conversationId: string | null,
    correlationId: string,
  ): Promise<AssistantWorkspaceResponse>;
  createConversation(
    actor: SessionActor,
    scope: ProfileScope,
    assistantId: AssistantId,
    title: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<{ response: AssistantWorkspaceResponse; replayed: boolean }>;
  acknowledge(
    actor: SessionActor,
    scope: ProfileScope,
    assistantId: AssistantId,
    conversationId: string,
    acknowledgement: string,
    correlationId: string,
  ): Promise<AssistantWorkspaceResponse>;
  sendMessage(
    actor: SessionActor,
    scope: ProfileScope,
    assistantId: AssistantId,
    conversationId: string,
    message: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<{ response: AssistantWorkspaceResponse; replayed: boolean }>;
}

export function createAssistantService(
  database: Database,
  runtime: AssistantRuntime,
): AssistantService {
  const serialized = createSerializer();
  return {
    async getWorkspace(actor, requestedScope, assistantId, conversationId, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      return database.transaction(async (client) => {
        const { canWrite } = await profileAccess(client, actor, scope);
        const response = await workspaceResponse(
          client,
          scope,
          assistantId,
          canWrite,
          conversationId,
        );
        await audit(client, {
          actor,
          scope,
          action: "profile.assistant.opened",
          resourceId: conversationId ?? scope.profileId,
          correlationId,
          now: new Date(),
        });
        return response;
      });
    },

    async createConversation(actor, requestedScope, assistantId, rawTitle, key, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const title = rawTitle.trim();
      if (title.length < 1 || title.length > 80) throw new DomainValidationError();
      return serialized(`${scope.familyId}:${scope.profileId}:create`, () =>
        database.transaction(async (client) => {
          await requireProfileWrite(client, actor, scope);
          const keyHash = sha256(key);
          const requestHash = sha256(JSON.stringify({ profileId: scope.profileId, title }));
          const table = "assistant_conversation_requests";
          const replay = await replayedConversation(
            client,
            table,
            scope,
            actor,
            keyHash,
            requestHash,
          );
          if (replay !== null) {
            const response = await workspaceResponse(client, scope, assistantId, true, replay);
            return { response, replayed: true };
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
               (id, family_id, patient_profile_id, assistant_id, created_by_user_id, title,
                created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
            [
              conversationId,
              scope.familyId,
              scope.profileId,
              assistantId,
              actor.userId,
              title,
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
          const response = await workspaceResponse(
            client,
            scope,
            assistantId,
            true,
            conversationId,
          );
          return { response, replayed: false };
        }),
      );
    },

    async acknowledge(actor, requestedScope, assistantId, conversationId, value, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      if (value !== ASSISTANT_EGRESS_ACKNOWLEDGEMENT) throw new DomainValidationError();
      return database.transaction(async (client) => {
        await requireProfileWrite(client, actor, scope);
        const conversation = await loadConversation(client, scope, conversationId);
        const now = new Date();
        if (conversation.acknowledged_at === null) {
          await client.query(
            `UPDATE assistant_conversations
                SET acknowledged_at = $1, acknowledged_by_user_id = $2, updated_at = $1
              WHERE family_id = $3 AND id = $4`,
            [now, actor.userId, scope.familyId, conversationId],
          );
          await audit(client, {
            actor,
            scope,
            action: "profile.assistant.egress_acknowledged",
            resourceId: conversationId,
            correlationId,
            now,
          });
        }
        return workspaceResponse(client, scope, assistantId, true, conversationId);
      });
    },

    async sendMessage(actor, requestedScope, assistantId, conversationId, raw, key, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const message = raw.trim();
      if (message.length < 1 || message.length > MAX_ASSISTANT_MESSAGE_LENGTH) {
        throw new DomainValidationError();
      }
      return serialized(`${scope.familyId}:${scope.profileId}:${conversationId}`, () =>
        sendAssistantMessage(
          { database, runtime },
          { actor, scope, assistantId, conversationId, message, key, correlationId },
        ),
      );
    },
  };
}
