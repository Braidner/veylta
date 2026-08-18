import { randomUUID } from "node:crypto";
import {
  ASSISTANT_OUTCOME_BLOCK_KINDS,
  ASSISTANT_OUTCOME_VERDICTS,
  type AssistantAnswer,
  type AssistantBlock,
  type AssistantId,
  type AssistantOutcome,
  type AssistantOutcomeBlockKind,
  type AssistantOutcomeEntry,
  type AssistantOutcomeRequest,
  type AssistantOutcomeSummary,
  type AssistantOutcomeVerdict,
  MAX_ASSISTANT_OUTCOME_ENTRIES,
  MAX_ASSISTANT_OUTCOME_NOTE_LENGTH,
} from "@veylta/contracts";
import type { DatabaseClient } from "../database/pool.js";
import {
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import type { ProfileScope } from "../family/profile-access.js";

const outcomeKinds = new Set<string>(ASSISTANT_OUTCOME_BLOCK_KINDS);
const verdicts = new Set<string>(ASSISTANT_OUTCOME_VERDICTS);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

interface OutcomeRow {
  conversation_id: string;
  conversation_title: string;
  message_id: string;
  block_index: number;
  block_kind: string;
  block_title: string;
  verdict: string;
  decided_on: string | null;
  note: string | null;
  clinician_record_id: string | null;
  recorded_at: string;
}

/** What the mark is about: the block's own name, or the сверка's position in the assistant's words. */
export function outcomeTitle(block: AssistantBlock): string | null {
  switch (block.kind) {
    case "hypothesis":
    case "treatment_option":
    case "diet_recommendation":
    case "activity_recommendation":
      return block.name.slice(0, 200);
    case "clinician_check":
      return block.ours.slice(0, 200);
    default:
      return null;
  }
}

function decidedOn(value: string | null): string | null {
  if (value === null) return null;
  if (!datePattern.test(value)) throw new DomainValidationError();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainValidationError();
  }
  return value;
}

function note(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ASSISTANT_OUTCOME_NOTE_LENGTH) {
    throw new DomainValidationError();
  }
  return trimmed;
}

/** The latest mark per (message, block) inside the room, newest first — the earlier ones stay. */
const latestSelect = `SELECT o.conversation_id, c.title AS conversation_title, o.message_id, o.block_index,
        o.block_kind, o.block_title, o.verdict, o.decided_on, o.note, o.clinician_record_id,
        o.recorded_at
   FROM assistant_outcomes o
   JOIN assistant_conversations c ON c.family_id = o.family_id AND c.id = o.conversation_id
  WHERE o.family_id = $1 AND o.patient_profile_id = $2 AND o.assistant_id = $3
    AND NOT EXISTS (
      SELECT 1 FROM assistant_outcomes later
       WHERE later.family_id = o.family_id AND later.message_id = o.message_id
         AND later.block_index = o.block_index
         AND (later.recorded_at > o.recorded_at
              OR (later.recorded_at = o.recorded_at AND later.rowid > o.rowid))
    )`;

function outcomeOf(row: OutcomeRow): AssistantOutcome {
  return {
    blockIndex: row.block_index,
    verdict: row.verdict as AssistantOutcomeVerdict,
    decidedOn: row.decided_on,
    note: row.note,
    recordId: row.clinician_record_id,
    recordedAt: row.recorded_at,
  };
}

/** The marks on one conversation's answers, latest per block, keyed by message. */
export async function outcomesByMessage(
  client: DatabaseClient,
  scope: ProfileScope,
  assistantId: AssistantId,
  conversationId: string,
): Promise<Map<string, AssistantOutcome[]>> {
  const rows = await client.query<OutcomeRow>(
    `${latestSelect} AND o.conversation_id = $4 ORDER BY o.message_id, o.block_index`,
    [scope.familyId, scope.profileId, assistantId, conversationId],
  );
  const byMessage = new Map<string, AssistantOutcome[]>();
  for (const row of rows.rows) {
    const list = byMessage.get(row.message_id) ?? [];
    list.push(outcomeOf(row));
    byMessage.set(row.message_id, list);
  }
  return byMessage;
}

/** The room's log at a glance: verdict counts, the сверка's claims so far, the marked blocks. */
export async function outcomeSummary(
  client: DatabaseClient,
  scope: ProfileScope,
  assistantId: AssistantId,
): Promise<AssistantOutcomeSummary> {
  const rows = await client.query<OutcomeRow>(
    `${latestSelect} ORDER BY o.recorded_at DESC, o.rowid DESC LIMIT ${MAX_ASSISTANT_OUTCOME_ENTRIES}`,
    [scope.familyId, scope.profileId, assistantId],
  );
  const counts = { confirmed: 0, rejected: 0, modified: 0 };
  const entries: AssistantOutcomeEntry[] = rows.rows.map((row) => {
    counts[row.verdict as AssistantOutcomeVerdict] += 1;
    return {
      ...outcomeOf(row),
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      messageId: row.message_id,
      blockKind: row.block_kind as AssistantOutcomeBlockKind,
      title: row.block_title,
    };
  });
  const claims = await client.query<{ claim: string; total: number }>(
    `SELECT json_extract(block.value, '$.claim') AS claim, count(*) AS total
       FROM assistant_messages m
       JOIN assistant_conversations c ON c.family_id = m.family_id AND c.id = m.conversation_id,
            json_each(m.answer_json, '$.blocks') AS block
      WHERE m.family_id = $1 AND c.patient_profile_id = $2 AND c.assistant_id = $3
        AND m.answer_json IS NOT NULL AND json_extract(block.value, '$.kind') = 'clinician_check'
      GROUP BY claim`,
    [scope.familyId, scope.profileId, assistantId],
  );
  const checks = { agree: 0, differs: 0, cannot_assess: 0 };
  for (const row of claims.rows) {
    if (row.claim in checks) checks[row.claim as keyof typeof checks] = row.total;
  }
  return { counts, checks, entries };
}

/**
 * The clinician's word on one block of one answer, as the person records it: a new row every
 * time (the latest stands), bound to a block the answer asked to confirm and, when given, to a
 * confirmed clinician record of this profile — anything else is a 422 or a 404, never a hint.
 */
export async function recordOutcome(
  client: DatabaseClient,
  input: {
    actor: SessionActor;
    scope: ProfileScope;
    assistantId: AssistantId;
    conversationId: string;
    messageId: string;
    blockIndex: number;
    request: AssistantOutcomeRequest;
    now: Date;
  },
): Promise<{ created: boolean }> {
  const { scope, request } = input;
  if (!verdicts.has(request.verdict)) throw new DomainValidationError();
  const decided = decidedOn(request.decidedOn);
  const text = note(request.note);
  const message = (
    await client.query<{ answer_json: string | null }>(
      `SELECT answer_json FROM assistant_messages
        WHERE family_id = $1 AND conversation_id = $2 AND id = $3 AND role = 'assistant'`,
      [scope.familyId, input.conversationId, input.messageId],
    )
  ).rows[0];
  if (message === undefined) throw new ResourceNotFoundError();
  if (message.answer_json === null) throw new DomainValidationError();
  const answer = JSON.parse(message.answer_json) as AssistantAnswer;
  const block = answer.blocks[input.blockIndex];
  const title = block === undefined ? null : outcomeTitle(block);
  if (block === undefined || title === null || !outcomeKinds.has(block.kind)) {
    throw new DomainValidationError();
  }
  if (request.recordId !== null) {
    const record = await client.query<{ id: string }>(
      `SELECT id FROM clinician_records
        WHERE family_id = $1 AND patient_profile_id = $2 AND id = $3 AND decision = 'confirmed'`,
      [scope.familyId, scope.profileId, request.recordId.toLowerCase()],
    );
    if (record.rows.length === 0) throw new ResourceNotFoundError();
  }
  const previous = await client.query<{ id: string }>(
    `SELECT id FROM assistant_outcomes WHERE family_id = $1 AND message_id = $2 AND block_index = $3`,
    [scope.familyId, input.messageId, input.blockIndex],
  );
  const id = randomUUID();
  await client.query(
    `INSERT INTO assistant_outcomes
       (id, family_id, patient_profile_id, assistant_id, conversation_id, message_id, block_index,
        block_kind, block_title, verdict, decided_on, note, clinician_record_id,
        recorded_by_user_id, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id,
      scope.familyId,
      scope.profileId,
      input.assistantId,
      input.conversationId,
      input.messageId,
      input.blockIndex,
      block.kind,
      title,
      request.verdict,
      decided,
      text,
      request.recordId === null ? null : request.recordId.toLowerCase(),
      input.actor.userId,
      input.now.toISOString(),
    ],
  );
  return { created: previous.rows.length === 0 };
}
