import {
  ASSISTANT_EGRESS_ACKNOWLEDGEMENT,
  type AssistantConsiliumRequest,
  type AssistantConversationCreateRequest,
  type AssistantId,
  type AssistantMessageRequest,
  type AssistantOutcomeRequest,
  type AssistantWorkspaceResponse,
  MAX_ASSISTANT_MESSAGE_LENGTH,
} from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import { createSerializer } from "../database/serialized.js";
import { DomainValidationError, type SessionActor } from "../family/family-service.js";
import {
  canonicalProfileScope,
  type ProfileScope,
  profileAccess,
  requireProfileWrite,
} from "../family/profile-access.js";
import { createAssistantConversation } from "./assistant-conversations.js";
import { sendAssistantTurn } from "./assistant-send.js";
import { audit, loadConversation, workspaceResponse } from "./assistant-storage.js";
import type { AssistantRuntime } from "./codex-assistant-runtime.js";
import { recordOutcomeInRoom } from "./outcome-flow.js";

export { AssistantIdempotencyConflictError } from "./assistant-requests.js";
export {
  AssistantAcknowledgementRequiredError,
  AssistantNobodyToConveneError,
} from "./assistant-send.js";

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
    input: AssistantConversationCreateRequest,
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
    request: AssistantMessageRequest,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<{ response: AssistantWorkspaceResponse; replayed: boolean }>;
  convene(
    actor: SessionActor,
    scope: ProfileScope,
    assistantId: AssistantId,
    conversationId: string,
    request: AssistantConsiliumRequest,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<{ response: AssistantWorkspaceResponse; replayed: boolean }>;
  /** The clinician's word on one block of one answer; the latest mark stands, earlier ones stay. */
  recordOutcome(
    actor: SessionActor,
    scope: ProfileScope,
    assistantId: AssistantId,
    conversationId: string,
    messageId: string,
    blockIndex: number,
    request: AssistantOutcomeRequest,
    correlationId: string,
  ): Promise<{ response: AssistantWorkspaceResponse; created: boolean }>;
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

    async createConversation(actor, requestedScope, assistantId, input, key, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const title = input.title.trim();
      if (title.length < 1 || title.length > 80) throw new DomainValidationError();
      return serialized(`${scope.familyId}:${scope.profileId}:create`, () =>
        database.transaction((client) =>
          createAssistantConversation(client, {
            actor,
            scope,
            assistantId,
            title,
            purpose: input.purpose ?? null,
            key,
            correlationId,
          }),
        ),
      );
    },

    async acknowledge(actor, requestedScope, assistantId, conversationId, value, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      if (value !== ASSISTANT_EGRESS_ACKNOWLEDGEMENT) throw new DomainValidationError();
      return database.transaction(async (client) => {
        await requireProfileWrite(client, actor, scope);
        const conversation = await loadConversation(client, scope, assistantId, conversationId);
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

    recordOutcome(actor, scope, assistantId, conversationId, messageId, blockIndex, request, id) {
      return recordOutcomeInRoom(database, {
        actor,
        scope,
        assistantId,
        conversationId,
        messageId,
        blockIndex,
        request,
        correlationId: id,
      });
    },

    async sendMessage(
      actor,
      requestedScope,
      assistantId,
      conversationId,
      body,
      key,
      correlationId,
    ) {
      const scope = canonicalProfileScope(requestedScope);
      const message = body.message.trim();
      if (message.length < 1 || message.length > MAX_ASSISTANT_MESSAGE_LENGTH) {
        throw new DomainValidationError();
      }
      return serialized(`${scope.familyId}:${scope.profileId}:${conversationId}`, () =>
        sendAssistantTurn(
          { database, runtime },
          {
            actor,
            scope,
            assistantId,
            conversationId,
            request: { kind: "message", message, addressee: body.addressee ?? null },
            key,
            correlationId,
          },
        ),
      );
    },

    async convene(actor, requestedScope, assistantId, conversationId, body, key, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const question = body.question === null ? null : body.question.trim();
      if (
        question !== null &&
        (question.length < 1 || question.length > MAX_ASSISTANT_MESSAGE_LENGTH)
      ) {
        throw new DomainValidationError();
      }
      return serialized(`${scope.familyId}:${scope.profileId}:${conversationId}`, () =>
        sendAssistantTurn(
          { database, runtime },
          {
            actor,
            scope,
            assistantId,
            conversationId,
            request: { kind: "consilium", question, specialties: body.specialties ?? [] },
            key,
            correlationId,
          },
        ),
      );
    },
  };
}
