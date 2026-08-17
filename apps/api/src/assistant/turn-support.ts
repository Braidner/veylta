import type {
  AssistantAnswer,
  AssistantCheckerVerdictRecord,
  AssistantExchange,
  AssistantOpinion,
  AssistantRejectionReason,
  AssistantSpecialty,
} from "@veylta/contracts";
import { checkerPrompt } from "../prompts/assistant-checker.prompt.js";
import { applyCheckerVerdicts, parseCheckerVerdicts } from "./answer-checker.js";
import { AssistantAnswerError } from "./answer-fields.js";
import { checkerSchema } from "./answer-schema.js";
import {
  type AssistantRuntime,
  AssistantRuntimeError,
  type AssistantRuntimeResult,
} from "./codex-assistant-runtime.js";
import type { AssistantEvidence } from "./evidence.js";

/** Bounds mirror the assistant_exchanges CHECKs; the journal keeps a prefix, never fails on size. */
export const maximumExchangeRequestChars = 262_144;
export const maximumExchangeResponseChars = 131_072;
export const unavailableRuntimeVersion = "unavailable";

export function exchange(
  stage: AssistantExchange["stage"],
  specialty: AssistantSpecialty | null,
  requestText: string,
  result: AssistantRuntimeResult | AssistantRuntimeError,
): AssistantExchange {
  const responseText = result instanceof AssistantRuntimeError ? "" : result.output;
  return {
    stage,
    specialty,
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

export function refusalOf(error: unknown): AssistantRejectionReason {
  if (error instanceof AssistantAnswerError) return error.reason;
  throw error;
}

export interface CheckedAnswer {
  readonly answer: AssistantAnswer | null;
  readonly refusal: AssistantRejectionReason | null;
  readonly checker: readonly AssistantCheckerVerdictRecord[];
  readonly exchanges: readonly AssistantExchange[];
}

/**
 * The refuting pass over one verified answer: an independent run in its own thread, its
 * verdicts applied; a fully refuted answer is refused as checker_unsafe, a checker that fails
 * to answer refuses the turn rather than showing an unchecked answer.
 */
export async function checkAnswer(
  runtime: AssistantRuntime,
  evidence: AssistantEvidence,
  answer: AssistantAnswer,
  opinions: readonly AssistantOpinion[] = [],
): Promise<CheckedAnswer> {
  if (!needsChecker(answer)) return { answer, refusal: null, checker: [], exchanges: [] };
  const review = checkerPrompt(evidence, answer, opinions);
  let reviewed: AssistantRuntimeResult;
  try {
    reviewed = await runtime.run({ threadId: null, prompt: review, schema: checkerSchema });
  } catch (error) {
    if (!(error instanceof AssistantRuntimeError)) throw error;
    return {
      answer: null,
      refusal: "provider_unavailable",
      checker: [],
      exchanges: [exchange("checker", null, review, error)],
    };
  }
  const exchanges = [exchange("checker", null, review, reviewed)];
  try {
    const verdicts = parseCheckerVerdicts(reviewed.output, answer.blocks.length);
    const kept = applyCheckerVerdicts(answer, verdicts);
    return {
      answer: kept,
      refusal: kept === null ? "checker_unsafe" : null,
      checker: verdicts.verdicts,
      exchanges,
    };
  } catch (error) {
    return { answer: null, refusal: refusalOf(error), checker: [], exchanges };
  }
}
