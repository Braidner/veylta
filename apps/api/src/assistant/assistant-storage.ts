import { randomUUID } from "node:crypto";
import {
  ASSISTANT_CONTRACT_VERSION,
  type AssistantConversationSummary,
  type AssistantId,
  type AssistantWorkspaceResponse,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import { ResourceNotFoundError, type SessionActor } from "../family/family-service.js";
import type { ProfileScope } from "../family/profile-access.js";
import { loadMessages } from "./assistant-messages.js";
import { consiliumPanel } from "./consilium-panel.js";
import { loadAssistantEvidence } from "./evidence.js";

export { persistTurn } from "./assistant-messages.js";

export interface ConversationRow {
  id: string;
  title: string;
  codex_thread_id: string | null;
  evidence_hash: string | null;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_at: string | null;
}

const conversationSelect = `
  SELECT c.id, c.title, c.codex_thread_id, c.evidence_hash, c.acknowledged_at,
         c.created_at, c.updated_at,
         (SELECT count(*) FROM assistant_messages m
           WHERE m.family_id = c.family_id AND m.conversation_id = c.id) AS message_count,
         (SELECT max(m.created_at) FROM assistant_messages m
           WHERE m.family_id = c.family_id AND m.conversation_id = c.id) AS last_message_at
    FROM assistant_conversations c`;

export async function loadConversation(
  client: DatabaseClient,
  scope: ProfileScope,
  conversationId: string,
): Promise<ConversationRow> {
  const row = (
    await client.query<ConversationRow>(
      `${conversationSelect} WHERE c.family_id = $1 AND c.patient_profile_id = $2 AND c.id = $3`,
      [scope.familyId, scope.profileId, conversationId],
    )
  ).rows[0];
  if (row === undefined) throw new ResourceNotFoundError();
  return row;
}

function summary(row: ConversationRow): AssistantConversationSummary {
  return {
    id: row.id,
    title: row.title,
    messageCount: row.message_count,
    lastMessageAt: row.last_message_at,
    acknowledged: row.acknowledged_at !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The whole workspace in one read: the rail of conversations, the selected one's messages, and
 * what the next message would carry (readiness and evidence count) from the same loader that
 * builds the prompt — so the disclosure never describes something other than what is sent.
 */
export async function workspaceResponse(
  client: DatabaseClient,
  scope: ProfileScope,
  assistantId: AssistantId,
  canWrite: boolean,
  selectedConversationId: string | null,
): Promise<AssistantWorkspaceResponse> {
  const conversations = (
    await client.query<ConversationRow>(
      `${conversationSelect}
        WHERE c.family_id = $1 AND c.patient_profile_id = $2 AND c.assistant_id = $3
        ORDER BY c.updated_at DESC, c.id`,
      [scope.familyId, scope.profileId, assistantId],
    )
  ).rows;
  if (
    selectedConversationId !== null &&
    !conversations.some((row) => row.id === selectedConversationId)
  ) {
    throw new ResourceNotFoundError();
  }
  const { evidence, sources } = await loadAssistantEvidence(client, scope);
  return {
    contractVersion: ASSISTANT_CONTRACT_VERSION,
    profileId: scope.profileId,
    assistantId,
    canWrite,
    interpretationReady: evidence.medicalProfile.interpretationReady,
    evidenceCount: evidence.observations.length,
    evidence: sources,
    consiliumPanel: consiliumPanel(evidence),
    conversations: conversations.map(summary),
    selectedConversationId,
    messages:
      selectedConversationId === null
        ? []
        : await loadMessages(client, scope, selectedConversationId, canWrite),
  };
}

export async function audit(
  client: DatabaseClient,
  input: {
    actor: SessionActor;
    scope: ProfileScope;
    action: string;
    resourceId: string;
    correlationId: string;
    now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, resource_type, resource_id, result,
        correlation_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, 'AssistantConversation', $5, 'success', $6, $7, $8)`,
    [
      randomUUID(),
      input.scope.familyId,
      input.actor.userId,
      input.action,
      input.resourceId,
      input.correlationId,
      { contractVersion: ASSISTANT_CONTRACT_VERSION },
      input.now,
    ],
  );
}
