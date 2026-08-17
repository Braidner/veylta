import {
  ASSISTANT_URGENCY_TIERS,
  type AssistantAnswer,
  type AssistantRejectionReason,
  type AssistantUrgency,
  MAX_ASSISTANT_BLOCKS,
} from "@veylta/contracts";
import { block } from "./answer-blocks.js";
import {
  AssistantAnswerError,
  boundedList,
  exactKeys,
  keepEach,
  member,
  object,
  refuse,
} from "./answer-fields.js";
import { type AnswerContext, refs } from "./answer-refs.js";

export type { AnswerContext };
export { AssistantAnswerError };

function urgency(value: unknown, context: AnswerContext): AssistantUrgency {
  if (value === undefined) refuse("missing_urgency");
  const proposed = object(value);
  exactKeys(proposed, ["tier", "reasons"]);
  return {
    tier: member(proposed.tier, ASSISTANT_URGENCY_TIERS),
    reasons: refs(proposed.reasons, context),
  };
}

/**
 * Turns the model's raw answer into the typed blocks the UI renders. Verification is per block:
 * a block that cannot be bound, names a dose, or quotes the profile in a "general" statement is
 * dropped; an answer whose every block fails is refused with the last rule broken. Urgency is
 * read first and never lowered because a reference did not resolve.
 */
export function parseAssistantAnswer(text: string, context: AnswerContext): AssistantAnswer {
  return answerFromRoot(parseAnswerJson(text), context, ["urgency", "blocks"]);
}

export function parseAnswerJson(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    refuse("schema_shape");
  }
  return object(parsed);
}

/** The urgency-and-blocks core shared by the physician answer and the консилиум synthesis. */
export function answerFromRoot(
  root: Record<string, unknown>,
  context: AnswerContext,
  keys: readonly string[],
): AssistantAnswer {
  if (!("urgency" in root)) refuse("missing_urgency");
  exactKeys(root, keys);
  const tier = urgency(root.urgency, context);
  const proposals = boundedList(root.blocks, MAX_ASSISTANT_BLOCKS);
  const blocks = keepEach(proposals, (proposal) => block(proposal, context));
  return { urgency: tier, blocks };
}

export type { AssistantRejectionReason };
