import type { AssistantId, ProfileOverviewAssistant } from "@veylta/contracts";
import { urgencyCopy } from "./assistant";
import { countCopy } from "./russian-plural";

const dayMs = 24 * 60 * 60 * 1000;

const startOfLocalDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** The first sentence of a longer line — what the room is for, without the paragraph. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  return /^[\s\S]*?[.!?](?=\s|$)/.exec(trimmed)?.[0] ?? trimmed;
}

/**
 * How long ago the room answered, as a phrase: «сегодня», «вчера», «5 дней назад». Whole calendar
 * days in the reader's own zone — an answer from last night is «вчера», not «14 часов назад».
 */
export function relativeDayCopy(at: string, now: Date): string {
  const days = Math.max(
    0,
    Math.round((startOfLocalDay(now) - startOfLocalDay(new Date(at))) / dayMs),
  );
  if (days === 0) return "сегодня";
  if (days === 1) return "вчера";
  return countCopy(days, ["день назад", "дня назад", "дней назад"]);
}

/**
 * What the room last said, as its card states it: the tier's own fixed copy for an answer, the
 * plain fact of a refusal — never its reason, which belongs to the room's journal — and, while
 * the room has never answered, one sentence of what it is for.
 */
export function assistantStateLine(
  assistants: readonly ProfileOverviewAssistant[],
  assistantId: AssistantId,
  fallback: string,
  now: Date,
): string {
  const entry = assistants.find((room) => room.assistantId === assistantId);
  if (entry === undefined) return firstSentence(fallback);
  if (entry.refused) return "Последний ответ не прошёл проверку";
  if (entry.urgency === null) return firstSentence(fallback);
  return `Последний ответ ${relativeDayCopy(entry.answeredAt, now)} · ${urgencyCopy[entry.urgency].label}`;
}
