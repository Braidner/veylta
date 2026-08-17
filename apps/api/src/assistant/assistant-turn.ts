import type {
  AssistantAnswer,
  AssistantCheckerVerdictRecord,
  AssistantExchange,
  AssistantRejectionReason,
} from "@veylta/contracts";
import { checkerPrompt } from "../prompts/assistant-checker.prompt.js";
import {
  physicianFollowUpPrompt,
  physicianOpeningPrompt,
} from "../prompts/assistant-physician.prompt.js";
import { applyCheckerVerdicts, parseCheckerVerdicts } from "./answer-checker.js";
import { AssistantAnswerError } from "./answer-fields.js";
import { parseAssistantAnswer } from "./answer-parser.js";
import { checkerSchema, physicianAnswerSchema } from "./answer-schema.js";
import {
  type AssistantRuntime,
  AssistantRuntimeError,
  type AssistantRuntimeResult,
} from "./codex-assistant-runtime.js";
import { type AssistantEvidence, answerContextOf } from "./evidence.js";

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
  readonly modelId: string;
  readonly runtimeVersion: string;
  readonly answer: AssistantAnswer | null;
  readonly refusal: AssistantRejectionReason | null;
  readonly checker: readonly AssistantCheckerVerdictRecord[];
  readonly exchanges: readonly AssistantExchange[];
}

/** Bounds mirror the assistant_exchanges CHECKs; the journal keeps a prefix, never fails on size. */
export const maximumExchangeRequestChars = 262_144;
export const maximumExchangeResponseChars = 131_072;
const unavailableRuntimeVersion = "unavailable";

function exchange(
  stage: AssistantExchange["stage"],
  requestText: string,
  result: AssistantRuntimeResult | AssistantRuntimeError,
): AssistantExchange {
  const responseText = result instanceof AssistantRuntimeError ? "" : result.output;
  return {
    stage,
    requestText: requestText.slice(0, maximumExchangeRequestChars),
    responseText: responseText.slice(0, maximumExchangeResponseChars),
    requestBytes: Buffer.byteLength(requestText, "utf8"),
    responseBytes: Buffer.byteLength(responseText, "utf8"),
    modelId: result.modelId,
    runtimeVersion: result instanceof AssistantRuntimeError ? null : result.runtimeVersion,
    durationMs: result.durationMs,
  };
}

/** Only an answer that says something about this person is worth a second, refuting run. */
export function needsChecker(answer: AssistantAnswer): boolean {
  return (
    answer.urgency.tier !== "none" ||
    answer.blocks.some((block) => block.kind !== "missing" && block.kind !== "general")
  );
}

function refusalOf(error: unknown): AssistantRejectionReason {
  if (error instanceof AssistantAnswerError) return error.reason;
  throw error;
}

/**
 * One physician turn: ask, verify against the evidence, let an independent run refute, keep
 * what survives. Every model failure becomes a refusal with a closed reason and its raw
 * exchange — the turn itself never throws for a model's sake.
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
    return {
      threadId: input.threadId,
      modelId: error.modelId,
      runtimeVersion: unavailableRuntimeVersion,
      answer: null,
      refusal: "provider_unavailable",
      checker: [],
      exchanges: [exchange("answer", prompt, error)],
    };
  }
  const base = {
    threadId: result.threadId,
    modelId: result.modelId,
    runtimeVersion: result.runtimeVersion,
    checker: [] as AssistantCheckerVerdictRecord[],
    exchanges: [exchange("answer", prompt, result)],
  };
  let answer: AssistantAnswer;
  try {
    answer = parseAssistantAnswer(result.output, answerContextOf(input.evidence));
  } catch (error) {
    return { ...base, answer: null, refusal: refusalOf(error) };
  }
  if (!needsChecker(answer)) return { ...base, answer, refusal: null };

  const review = checkerPrompt(input.evidence, answer);
  let reviewed: AssistantRuntimeResult;
  try {
    reviewed = await runtime.run({ threadId: null, prompt: review, schema: checkerSchema });
  } catch (error) {
    if (!(error instanceof AssistantRuntimeError)) throw error;
    return {
      ...base,
      answer: null,
      refusal: "provider_unavailable",
      exchanges: [...base.exchanges, exchange("checker", review, error)],
    };
  }
  const exchanges = [...base.exchanges, exchange("checker", review, reviewed)];
  try {
    const verdicts = parseCheckerVerdicts(reviewed.output, answer.blocks.length);
    const kept = applyCheckerVerdicts(answer, verdicts);
    return {
      ...base,
      exchanges,
      checker: verdicts.verdicts,
      answer: kept,
      refusal: kept === null ? "checker_unsafe" : null,
    };
  } catch (error) {
    return { ...base, exchanges, answer: null, refusal: refusalOf(error) };
  }
}
