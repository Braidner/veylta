import { randomUUID } from "node:crypto";
import type {
  AssistantAnswer,
  AssistantCheckerVerdictRecord,
  AssistantConsilium,
  AssistantExchange,
  AssistantId,
  AssistantMessage,
  AssistantOutcome,
  AssistantRejectionReason,
  AssistantSpecialty,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { SessionActor } from "../family/family-service.js";
import type { ProfileScope } from "../family/profile-access.js";
import { outcomesByMessage } from "./assistant-outcomes.js";
import type { AssistantTurnOutcome } from "./assistant-turn.js";

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  text: string | null;
  addressee: string | null;
  speaker: string | null;
  answer_json: string | null;
  refusal_reason: string | null;
  checker_json: string;
  consilium_json: string | null;
  model_id: string | null;
  runtime_version: string | null;
  created_at: string;
}

interface ExchangeRow {
  message_id: string;
  stage: AssistantExchange["stage"];
  specialty: string | null;
  request_text: string;
  response_text: string;
  request_bytes: number;
  response_bytes: number;
  model_id: string;
  runtime_version: string | null;
  duration_ms: number;
}

function messageFromRow(
  row: MessageRow,
  exchanges: readonly AssistantExchange[] | null,
  outcomes: readonly AssistantOutcome[],
): AssistantMessage {
  if (row.role === "user") {
    return {
      id: row.id,
      role: "user",
      text: row.text ?? "",
      addressee: row.addressee as AssistantSpecialty | null,
      createdAt: row.created_at,
    };
  }
  return {
    id: row.id,
    role: "assistant",
    speaker: row.speaker as AssistantSpecialty | null,
    answer: row.answer_json === null ? null : (JSON.parse(row.answer_json) as AssistantAnswer),
    refusal: row.refusal_reason as AssistantRejectionReason | null,
    checker: JSON.parse(row.checker_json) as AssistantCheckerVerdictRecord[],
    consilium:
      row.consilium_json === null ? null : (JSON.parse(row.consilium_json) as AssistantConsilium),
    provenance: { modelId: row.model_id ?? "", runtimeVersion: row.runtime_version ?? "" },
    outcomes,
    exchanges,
    createdAt: row.created_at,
  };
}

async function loadExchanges(
  client: DatabaseClient,
  scope: ProfileScope,
  conversationId: string,
): Promise<Map<string, AssistantExchange[]>> {
  const rows = (
    await client.query<ExchangeRow>(
      `SELECT message_id, stage, specialty, request_text, response_text, request_bytes,
              response_bytes, model_id, runtime_version, duration_ms
         FROM assistant_exchanges
        WHERE family_id = $1 AND conversation_id = $2
        ORDER BY created_at, rowid`,
      [scope.familyId, conversationId],
    )
  ).rows;
  const byMessage = new Map<string, AssistantExchange[]>();
  for (const row of rows) {
    const list = byMessage.get(row.message_id) ?? [];
    list.push({
      stage: row.stage,
      specialty: row.specialty as AssistantSpecialty | null,
      requestText: row.request_text,
      responseText: row.response_text,
      requestBytes: row.request_bytes,
      responseBytes: row.response_bytes,
      modelId: row.model_id,
      runtimeVersion: row.runtime_version,
      durationMs: row.duration_ms,
    });
    byMessage.set(row.message_id, list);
  }
  return byMessage;
}

/** The conversation in order; the raw exchanges ride along only for someone who may write. */
export async function loadMessages(
  client: DatabaseClient,
  scope: ProfileScope,
  assistantId: AssistantId,
  conversationId: string,
  withExchanges: boolean,
): Promise<AssistantMessage[]> {
  const rows = (
    await client.query<MessageRow>(
      `SELECT id, role, text, addressee, speaker, answer_json, refusal_reason, checker_json,
              consilium_json, model_id, runtime_version, created_at
         FROM assistant_messages
        WHERE family_id = $1 AND conversation_id = $2
        ORDER BY sequence`,
      [scope.familyId, conversationId],
    )
  ).rows;
  const exchanges = withExchanges ? await loadExchanges(client, scope, conversationId) : null;
  const outcomes = await outcomesByMessage(client, scope, assistantId, conversationId);
  return rows.map((row) =>
    messageFromRow(
      row,
      exchanges === null ? null : (exchanges.get(row.id) ?? []),
      outcomes.get(row.id) ?? [],
    ),
  );
}

/** The user's message and the assistant's outcome land together, with the raw exchanges. */
export async function persistTurn(
  client: DatabaseClient,
  input: {
    scope: ProfileScope;
    actor: SessionActor;
    conversationId: string;
    sequence: number;
    /** The person's words — a message, or the question a консилиум was convened on. */
    message: string;
    addressee: AssistantSpecialty | null;
    outcome: AssistantTurnOutcome;
    now: Date;
  },
): Promise<{ userMessageId: string; assistantMessageId: string }> {
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const { outcome } = input;
  await client.query(
    `INSERT INTO assistant_messages
       (id, family_id, conversation_id, sequence, role, actor_user_id, text, addressee, speaker,
        answer_json, urgency_tier, refusal_reason, checker_json, consilium_json, model_id,
        runtime_version, created_at)
     VALUES ($1, $2, $3, $4, 'user', $5, $6, $16, NULL, NULL, NULL, NULL, '[]', NULL, NULL,
             NULL, $7),
            ($8, $2, $3, $9, 'assistant', NULL, NULL, NULL, $17, $10, $11, $12, $13, $18, $14,
             $15, $7)`,
    [
      userMessageId,
      input.scope.familyId,
      input.conversationId,
      input.sequence,
      input.actor.userId,
      input.message,
      input.now,
      assistantMessageId,
      input.sequence + 1,
      outcome.answer === null ? null : JSON.stringify(outcome.answer),
      outcome.answer?.urgency.tier ?? null,
      outcome.refusal,
      JSON.stringify(outcome.checker),
      outcome.modelId,
      outcome.runtimeVersion,
      input.addressee,
      outcome.speaker,
      outcome.consilium === null ? null : JSON.stringify(outcome.consilium),
    ],
  );
  for (const item of outcome.exchanges) {
    await client.query(
      `INSERT INTO assistant_exchanges
         (id, family_id, conversation_id, message_id, stage, specialty, model_id,
          runtime_version, request_bytes, response_bytes, request_text, response_text,
          duration_ms, created_at)
       VALUES ($1, $2, $3, $4, $5, $14, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        randomUUID(),
        input.scope.familyId,
        input.conversationId,
        assistantMessageId,
        item.stage,
        item.modelId,
        item.runtimeVersion,
        item.requestBytes,
        item.responseBytes,
        item.requestText,
        item.responseText,
        item.durationMs,
        input.now,
        item.specialty,
      ],
    );
  }
  return { userMessageId, assistantMessageId };
}
