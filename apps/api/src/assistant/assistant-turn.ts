import type {
  AssistantAnswer,
  AssistantCheckerVerdictRecord,
  AssistantConsilium,
  AssistantExchange,
  AssistantRejectionReason,
  AssistantSpecialty,
} from "@veylta/contracts";
import {
  physicianFollowUpPrompt,
  physicianOpeningPrompt,
} from "../prompts/assistant-physician.prompt.js";
import { specialistOpeningPrompt } from "../prompts/assistant-specialist.prompt.js";
import { parseAssistantAnswer } from "./answer-parser.js";
import { physicianAnswerSchema } from "./answer-schema.js";
import {
  type AssistantRuntime,
  AssistantRuntimeError,
  type AssistantRuntimeResult,
} from "./codex-assistant-runtime.js";
import { type AssistantEvidence, answerContextOf } from "./evidence.js";
import { checkAnswer, exchange, refusalOf, unavailableRuntimeVersion } from "./turn-support.js";

export interface AssistantTurnInput {
  readonly threadId: string | null;
  readonly evidence: AssistantEvidence;
  /** A follow-up re-sends the evidence only when it changed since the thread last saw it. */
  readonly evidenceChanged: boolean;
  readonly message: string;
}

/** Everything one turn produced, in the shape the service persists as one assistant message. */
export interface AssistantTurnOutcome {
  readonly threadId: string | null;
  /** null is the therapist; a specialty is that persona answering alone. */
  readonly speaker: AssistantSpecialty | null;
  readonly modelId: string;
  readonly runtimeVersion: string;
  readonly answer: AssistantAnswer | null;
  readonly refusal: AssistantRejectionReason | null;
  readonly checker: readonly AssistantCheckerVerdictRecord[];
  readonly consilium: AssistantConsilium | null;
  readonly exchanges: readonly AssistantExchange[];
}

export { needsChecker } from "./turn-support.js";

function unavailable(
  error: AssistantRuntimeError,
  threadId: string | null,
  speaker: AssistantSpecialty | null,
  stage: AssistantExchange["stage"],
  prompt: string,
): AssistantTurnOutcome {
  return {
    threadId,
    speaker,
    modelId: error.modelId,
    runtimeVersion: unavailableRuntimeVersion,
    answer: null,
    refusal: "provider_unavailable",
    checker: [],
    consilium: null,
    exchanges: [exchange(stage, speaker, prompt, error)],
  };
}

/** Ask, verify against the evidence, let an independent run refute, keep what survives. */
async function answerAndCheck(
  runtime: AssistantRuntime,
  evidence: AssistantEvidence,
  result: AssistantRuntimeResult,
  first: AssistantExchange,
  speaker: AssistantSpecialty | null,
): Promise<AssistantTurnOutcome> {
  const base = {
    threadId: result.threadId,
    speaker,
    modelId: result.modelId,
    runtimeVersion: result.runtimeVersion,
    consilium: null,
  };
  let answer: AssistantAnswer;
  try {
    answer = parseAssistantAnswer(result.output, answerContextOf(evidence));
  } catch (error) {
    return { ...base, answer: null, refusal: refusalOf(error), checker: [], exchanges: [first] };
  }
  const checked = await checkAnswer(runtime, evidence, answer);
  return { ...base, ...checked, exchanges: [first, ...checked.exchanges] };
}

/**
 * One physician turn on the conversation's thread. Every model failure becomes a refusal with
 * a closed reason and its raw exchange — the turn itself never throws for a model's sake.
 */
export async function runPhysicianTurn(
  runtime: AssistantRuntime,
  input: AssistantTurnInput,
): Promise<AssistantTurnOutcome> {
  const prompt =
    input.threadId === null
      ? physicianOpeningPrompt(input.evidence, input.message)
      : physicianFollowUpPrompt(input.evidenceChanged ? input.evidence : null, input.message);
  let result: AssistantRuntimeResult;
  try {
    result = await runtime.run({ threadId: input.threadId, prompt, schema: physicianAnswerSchema });
  } catch (error) {
    if (!(error instanceof AssistantRuntimeError)) throw error;
    return unavailable(error, input.threadId, null, "answer", prompt);
  }
  return answerAndCheck(
    runtime,
    input.evidence,
    result,
    exchange("answer", null, prompt, result),
    null,
  );
}

/**
 * One specialist persona answering the person directly («Спросить эндокринолога»): a fresh
 * run over the same evidence, verified and refuted like the therapist's own answer.
 */
export async function runSpecialistTurn(
  runtime: AssistantRuntime,
  input: {
    readonly evidence: AssistantEvidence;
    readonly specialty: AssistantSpecialty;
    readonly message: string;
  },
): Promise<AssistantTurnOutcome> {
  const prompt = specialistOpeningPrompt(input.specialty, input.evidence, input.message);
  let result: AssistantRuntimeResult;
  try {
    result = await runtime.run({ threadId: null, prompt, schema: physicianAnswerSchema });
  } catch (error) {
    if (!(error instanceof AssistantRuntimeError)) throw error;
    return unavailable(error, null, input.specialty, "opinion", prompt);
  }
  const outcome = await answerAndCheck(
    runtime,
    input.evidence,
    result,
    exchange("opinion", input.specialty, prompt, result),
    input.specialty,
  );
  // A persona's own thread is not the conversation's; the therapist thread stays pinned.
  return { ...outcome, threadId: null };
}
