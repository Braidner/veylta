import type { AssistantId, AssistantWorkspaceResponse } from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import {
  DomainConflictError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import { type ProfileScope, requireProfileWrite } from "../family/profile-access.js";
import {
  evidenceHash,
  recordMessageRequest,
  rememberThread,
  replayedConversation,
  sha256,
} from "./assistant-requests.js";
import { audit, loadConversation, persistTurn, workspaceResponse } from "./assistant-storage.js";
import { runPhysicianTurn } from "./assistant-turn.js";
import type { AssistantRuntime } from "./codex-assistant-runtime.js";
import { loadAssistantEvidence } from "./evidence.js";

/** The egress disclosure was not confirmed for this conversation; nothing left the machine. */
export class AssistantAcknowledgementRequiredError extends DomainConflictError {}

const maximumMessagesPerConversation = 100;

/**
 * One message, end to end: authorise and snapshot the evidence inside a transaction, run the
 * model outside it, then persist the whole turn — user message, verified answer or refusal,
 * raw exchanges, idempotency record — in a second transaction that re-checks access. The
 * caller serialises per conversation so two turns never race for the same thread.
 */
export async function sendAssistantMessage(
  dependencies: { database: Database; runtime: AssistantRuntime },
  input: {
    actor: SessionActor;
    scope: ProfileScope;
    assistantId: AssistantId;
    conversationId: string;
    message: string;
    key: string;
    correlationId: string;
  },
): Promise<{ response: AssistantWorkspaceResponse; replayed: boolean }> {
  const { database, runtime } = dependencies;
  const { actor, scope, assistantId, conversationId, message, correlationId } = input;
  const keyHash = sha256(input.key);
  const requestHash = sha256(JSON.stringify({ conversationId, message }));
  const table = "assistant_message_requests";
  const prepared = await database.transaction(async (client) => {
    await requireProfileWrite(client, actor, scope);
    const replay = await replayedConversation(client, table, scope, actor, keyHash, requestHash);
    if (replay !== null) {
      if (replay !== conversationId) throw new ResourceNotFoundError();
      return { replayed: await workspaceResponse(client, scope, assistantId, true, replay) };
    }
    const conversation = await loadConversation(client, scope, conversationId);
    if (conversation.acknowledged_at === null) throw new AssistantAcknowledgementRequiredError();
    if (conversation.message_count + 2 > maximumMessagesPerConversation) {
      throw new DomainConflictError();
    }
    return { conversation, evidence: await loadAssistantEvidence(client, scope) };
  });
  if ("replayed" in prepared) return { response: prepared.replayed, replayed: true };

  const { conversation, evidence } = prepared;
  const hash = evidenceHash(evidence);
  const outcome = await runPhysicianTurn(runtime, {
    threadId: conversation.codex_thread_id,
    evidence,
    evidenceChanged: conversation.evidence_hash !== hash,
    message,
  });

  const response = await database.transaction(async (client) => {
    await requireProfileWrite(client, actor, scope);
    const latest = await loadConversation(client, scope, conversationId);
    const now = new Date();
    const ids = await persistTurn(client, {
      scope,
      actor,
      conversationId,
      sequence: latest.message_count + 1,
      message,
      outcome,
      now,
    });
    await rememberThread(client, scope, latest, outcome, hash, now);
    await recordMessageRequest(client, {
      scope,
      actor,
      conversationId,
      ...ids,
      keyHash,
      requestHash,
      now,
    });
    await audit(client, {
      actor,
      scope,
      action: "profile.assistant.message_created",
      resourceId: conversationId,
      correlationId,
      now,
    });
    return workspaceResponse(client, scope, assistantId, true, conversationId);
  });
  return { response, replayed: false };
}
