import type {
  AssistantId,
  AssistantInvitation,
  AssistantSpecialty,
  AssistantWorkspaceResponse,
} from "@veylta/contracts";
import { MAX_CONSILIUM_SPECIALISTS } from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import {
  DomainConflictError,
  DomainValidationError,
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
import {
  type AssistantTurnOutcome,
  runNutritionistTurn,
  runPhysicianTurn,
  runSpecialistTurn,
} from "./assistant-turn.js";
import type { AssistantRuntime } from "./codex-assistant-runtime.js";
import { consiliumPanel } from "./consilium-panel.js";
import { runConsiliumTurn } from "./consilium-turn.js";
import { type AssistantEvidence, loadAssistantEvidence } from "./evidence.js";

/** The egress disclosure was not confirmed for this conversation; nothing left the machine. */
export class AssistantAcknowledgementRequiredError extends DomainConflictError {}
/** A консилиум needs at least one specialist; the evidence named none and the person added none. */
export class AssistantNobodyToConveneError extends DomainConflictError {}

const maximumMessagesPerConversation = 100;

/** What the person asked for: a message to the therapist or one persona, or the консилиум. */
export type AssistantTurnRequest =
  | {
      readonly kind: "message";
      readonly message: string;
      readonly addressee: AssistantSpecialty | null;
    }
  | {
      readonly kind: "consilium";
      readonly question: string | null;
      readonly specialties: readonly AssistantSpecialty[];
    };

/** The deterministic panel plus whoever the person added, capped and de-duplicated. */
export function convenedPanel(
  evidence: AssistantEvidence,
  added: readonly AssistantSpecialty[],
): AssistantInvitation[] {
  const panel = consiliumPanel(evidence);
  const invited = new Set(panel.map((invitation) => invitation.specialty));
  for (const specialty of added) {
    if (invited.has(specialty) || specialty === "therapist" || specialty === "other") continue;
    invited.add(specialty);
    panel.push({ specialty, observationIds: [] });
  }
  return panel.slice(0, MAX_CONSILIUM_SPECIALISTS);
}

function userText(request: AssistantTurnRequest): string {
  return request.kind === "message" ? request.message : (request.question ?? "Собрать консилиум");
}

/**
 * One turn, end to end: authorise and snapshot the evidence inside a transaction, run the
 * model outside it, then persist the whole turn — user message, verified answer or refusal,
 * raw exchanges, idempotency record — in a second transaction that re-checks access. The
 * caller serialises per conversation so two turns never race for the same thread.
 */
export async function sendAssistantTurn(
  dependencies: { database: Database; runtime: AssistantRuntime },
  input: {
    actor: SessionActor;
    scope: ProfileScope;
    assistantId: AssistantId;
    conversationId: string;
    request: AssistantTurnRequest;
    key: string;
    correlationId: string;
  },
): Promise<{ response: AssistantWorkspaceResponse; replayed: boolean }> {
  const { database, runtime } = dependencies;
  const { actor, scope, assistantId, conversationId, request, correlationId } = input;
  const keyHash = sha256(input.key);
  const requestHash = sha256(JSON.stringify({ conversationId, request }));
  const table = "assistant_message_requests";
  const prepared = await database.transaction(async (client) => {
    await requireProfileWrite(client, actor, scope);
    const replay = await replayedConversation(client, table, scope, actor, keyHash, requestHash);
    if (replay !== null) {
      if (replay !== conversationId) throw new ResourceNotFoundError();
      return { replayed: await workspaceResponse(client, scope, assistantId, true, replay) };
    }
    const conversation = await loadConversation(client, scope, assistantId, conversationId);
    if (conversation.acknowledged_at === null) throw new AssistantAcknowledgementRequiredError();
    // Personas and the консилиум belong to the physician's room; the others answer alone.
    if (
      assistantId !== "physician" &&
      (request.kind === "consilium" || request.addressee !== null)
    ) {
      throw new DomainValidationError();
    }
    if (conversation.message_count + 2 > maximumMessagesPerConversation) {
      throw new DomainConflictError();
    }
    const { evidence } = await loadAssistantEvidence(client, scope);
    const invitations =
      request.kind === "consilium" ? convenedPanel(evidence, request.specialties) : [];
    if (request.kind === "consilium" && invitations.length === 0) {
      throw new AssistantNobodyToConveneError();
    }
    return { conversation, evidence, invitations };
  });
  if ("replayed" in prepared) return { response: prepared.replayed, replayed: true };

  const { conversation, evidence, invitations } = prepared;
  const hash = evidenceHash(evidence);
  const evidenceChanged = conversation.evidence_hash !== hash;
  const threadId = conversation.codex_thread_id;
  let outcome: AssistantTurnOutcome;
  if (request.kind === "consilium") {
    outcome = await runConsiliumTurn(runtime, {
      threadId,
      evidence,
      evidenceChanged,
      invitations,
      question: request.question,
    });
  } else if (request.addressee !== null) {
    outcome = await runSpecialistTurn(runtime, {
      evidence,
      specialty: request.addressee,
      message: request.message,
    });
  } else if (assistantId === "nutritionist") {
    outcome = await runNutritionistTurn(runtime, {
      threadId,
      evidence,
      evidenceChanged,
      message: request.message,
    });
  } else {
    outcome = await runPhysicianTurn(runtime, {
      threadId,
      evidence,
      evidenceChanged,
      message: request.message,
    });
  }

  const response = await database.transaction(async (client) => {
    await requireProfileWrite(client, actor, scope);
    const latest = await loadConversation(client, scope, assistantId, conversationId);
    const now = new Date();
    const ids = await persistTurn(client, {
      scope,
      actor,
      conversationId,
      sequence: latest.message_count + 1,
      message: userText(request),
      addressee: request.kind === "message" ? request.addressee : null,
      outcome,
      now,
    });
    // A persona's own run never touches the therapist's thread or its evidence digest.
    if (!(request.kind === "message" && request.addressee !== null)) {
      await rememberThread(client, scope, latest, outcome, hash, now);
    }
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
      action:
        request.kind === "consilium"
          ? "profile.assistant.consilium_convened"
          : "profile.assistant.message_created",
      resourceId: conversationId,
      correlationId,
      now,
    });
    return workspaceResponse(client, scope, assistantId, true, conversationId);
  });
  return { response, replayed: false };
}
