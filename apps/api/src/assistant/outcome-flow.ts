import type {
  AssistantId,
  AssistantOutcomeRequest,
  AssistantWorkspaceResponse,
} from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import type { SessionActor } from "../family/family-service.js";
import {
  canonicalProfileScope,
  type ProfileScope,
  requireProfileWrite,
} from "../family/profile-access.js";
import { recordOutcome } from "./assistant-outcomes.js";
import { audit, loadConversation, workspaceResponse } from "./assistant-storage.js";

/**
 * One mark end to end: authorise the profile, find the conversation in this room (a message under
 * another room's route is a 404), append the mark, audit it payload-free, and hand back the
 * workspace so the answer and the room's log refresh together.
 */
export async function recordOutcomeInRoom(
  database: Database,
  input: {
    actor: SessionActor;
    scope: ProfileScope;
    assistantId: AssistantId;
    conversationId: string;
    messageId: string;
    blockIndex: number;
    request: AssistantOutcomeRequest;
    correlationId: string;
  },
): Promise<{ response: AssistantWorkspaceResponse; created: boolean }> {
  const scope = canonicalProfileScope(input.scope);
  const { actor, assistantId, conversationId, messageId } = input;
  return database.transaction(async (client) => {
    await requireProfileWrite(client, actor, scope);
    await loadConversation(client, scope, assistantId, conversationId);
    const now = new Date();
    const { created } = await recordOutcome(client, {
      actor,
      scope,
      assistantId,
      conversationId,
      messageId,
      blockIndex: input.blockIndex,
      request: input.request,
      now,
    });
    await audit(client, {
      actor,
      scope,
      action: "assistant.outcome.recorded",
      resourceType: "AssistantOutcome",
      resourceId: messageId,
      correlationId: input.correlationId,
      now,
    });
    return {
      created,
      response: await workspaceResponse(client, scope, assistantId, true, conversationId),
    };
  });
}
