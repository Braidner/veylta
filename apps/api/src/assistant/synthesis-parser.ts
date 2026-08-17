import {
  ASSISTANT_AGREEMENT_VERDICTS,
  ASSISTANT_SPECIALTIES,
  type AssistantAgreement,
  type AssistantAnswer,
  type AssistantSpecialty,
  MAX_CONSILIUM_AGREEMENTS,
} from "@veylta/contracts";
import {
  AssistantAnswerError,
  boundedList,
  exactKeys,
  member,
  object,
  refuse,
  russianText,
} from "./answer-fields.js";
import { type AnswerContext, answerFromRoot, parseAnswerJson } from "./answer-parser.js";

export interface AssistantSynthesis {
  readonly answer: AssistantAnswer;
  readonly agreements: readonly AssistantAgreement[];
}

function agreement(proposal: unknown, known: ReadonlySet<string>): AssistantAgreement {
  const record = object(proposal);
  exactKeys(record, ["topic", "verdict", "specialties", "why"]);
  const specialties = boundedList(record.specialties, 6)
    .map((value) => member(value, ASSISTANT_SPECIALTIES))
    .filter((specialty) => known.has(specialty));
  if (specialties.length === 0) refuse("unbound_reference");
  return {
    topic: russianText(record.topic, 200),
    verdict: member(record.verdict, ASSISTANT_AGREEMENT_VERDICTS),
    specialties,
    why: russianText(record.why, 500),
  };
}

/**
 * The therapist's synthesis: a physician answer verified like any other, plus the agreement
 * notes. A note that names nobody from the консилиум, or breaks the shape, is dropped on its
 * own — the notes are commentary on opinions that were actually given, never the answer.
 */
export function parseSynthesis(
  text: string,
  context: AnswerContext,
  invited: readonly AssistantSpecialty[],
): AssistantSynthesis {
  const root = parseAnswerJson(text);
  const answer = answerFromRoot(root, context, ["urgency", "blocks", "agreements"]);
  const known = new Set<string>(invited);
  const agreements: AssistantAgreement[] = [];
  for (const proposal of boundedList(root.agreements, MAX_CONSILIUM_AGREEMENTS)) {
    try {
      agreements.push(agreement(proposal, known));
    } catch (error) {
      if (!(error instanceof AssistantAnswerError)) throw error;
    }
  }
  return { answer, agreements };
}
