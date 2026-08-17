import type {
  AssistantAnswer,
  AssistantExchange,
  AssistantInvitation,
  AssistantOpinion,
} from "@veylta/contracts";
import { specialistOpeningPrompt } from "../prompts/assistant-specialist.prompt.js";
import { synthesisPrompt } from "../prompts/assistant-synthesis.prompt.js";
import { parseAssistantAnswer } from "./answer-parser.js";
import { physicianAnswerSchema, synthesisSchema } from "./answer-schema.js";
import type { AssistantTurnOutcome } from "./assistant-turn.js";
import {
  type AssistantRuntime,
  AssistantRuntimeError,
  type AssistantRuntimeResult,
} from "./codex-assistant-runtime.js";
import { type AssistantEvidence, answerContextOf } from "./evidence.js";
import { parseSynthesis } from "./synthesis-parser.js";
import { checkAnswer, exchange, refusalOf, unavailableRuntimeVersion } from "./turn-support.js";

export interface ConsiliumTurnInput {
  readonly threadId: string | null;
  readonly evidence: AssistantEvidence;
  readonly evidenceChanged: boolean;
  readonly invitations: readonly AssistantInvitation[];
  readonly question: string | null;
}

interface OpinionRun {
  readonly opinion: AssistantOpinion;
  readonly exchanges: readonly AssistantExchange[];
}

/** One persona's read: its own run, verified per block and refuted like any answer. */
async function opinionOf(
  runtime: AssistantRuntime,
  evidence: AssistantEvidence,
  invitation: AssistantInvitation,
  question: string | null,
): Promise<OpinionRun> {
  const { specialty } = invitation;
  const prompt = specialistOpeningPrompt(specialty, evidence, question);
  let result: AssistantRuntimeResult;
  try {
    result = await runtime.run({ threadId: null, prompt, schema: physicianAnswerSchema });
  } catch (error) {
    if (!(error instanceof AssistantRuntimeError)) throw error;
    return {
      opinion: { specialty, answer: null, refusal: "provider_unavailable", checker: [] },
      exchanges: [exchange("opinion", specialty, prompt, error)],
    };
  }
  const first = exchange("opinion", specialty, prompt, result);
  let answer: AssistantAnswer;
  try {
    answer = parseAssistantAnswer(result.output, answerContextOf(evidence));
  } catch (error) {
    return {
      opinion: { specialty, answer: null, refusal: refusalOf(error), checker: [] },
      exchanges: [first],
    };
  }
  const checked = await checkAnswer(runtime, evidence, answer);
  return {
    opinion: {
      specialty,
      answer: checked.answer,
      refusal: checked.refusal,
      checker: checked.checker,
    },
    // The opinion's own checker carries the specialty too, so the journal keeps one per persona.
    exchanges: [first, ...checked.exchanges.map((item) => ({ ...item, specialty }))],
  };
}

/**
 * The консилиум: every invited persona reads the evidence at once, then the therapist
 * synthesises on the conversation's own thread and the checker refutes the synthesis. The
 * opinions travel with the message whatever the synthesis does — a person always sees each
 * specialist's own words, so no disagreement can be averaged away.
 */
export async function runConsiliumTurn(
  runtime: AssistantRuntime,
  input: ConsiliumTurnInput,
): Promise<AssistantTurnOutcome> {
  const runs = await Promise.all(
    input.invitations.map((invitation) =>
      opinionOf(runtime, input.evidence, invitation, input.question),
    ),
  );
  const opinions = runs.map((run) => run.opinion);
  const opinionExchanges = runs.flatMap((run) => run.exchanges);
  const consilium = { invitations: input.invitations, opinions, agreements: [] };
  const answered = opinions.filter((opinion) => opinion.answer !== null);
  const prompt = synthesisPrompt({
    evidence: input.evidenceChanged || input.threadId === null ? input.evidence : null,
    opening: input.threadId === null,
    invitations: input.invitations,
    opinions,
    question: input.question,
  });
  const base = { threadId: input.threadId, speaker: null, consilium };
  if (answered.length === 0) {
    const first = opinions[0];
    return {
      ...base,
      modelId: opinionExchanges[0]?.modelId ?? "unknown",
      runtimeVersion: opinionExchanges[0]?.runtimeVersion ?? unavailableRuntimeVersion,
      answer: null,
      refusal: first?.refusal ?? "provider_unavailable",
      checker: [],
      exchanges: opinionExchanges,
    };
  }
  let result: AssistantRuntimeResult;
  try {
    result = await runtime.run({ threadId: input.threadId, prompt, schema: synthesisSchema });
  } catch (error) {
    if (!(error instanceof AssistantRuntimeError)) throw error;
    return {
      ...base,
      modelId: error.modelId,
      runtimeVersion: unavailableRuntimeVersion,
      answer: null,
      refusal: "provider_unavailable",
      checker: [],
      exchanges: [...opinionExchanges, exchange("synthesis", null, prompt, error)],
    };
  }
  const exchanges = [...opinionExchanges, exchange("synthesis", null, prompt, result)];
  const settled = {
    ...base,
    threadId: result.threadId,
    modelId: result.modelId,
    runtimeVersion: result.runtimeVersion,
  };
  let synthesis: ReturnType<typeof parseSynthesis>;
  try {
    synthesis = parseSynthesis(
      result.output,
      answerContextOf(input.evidence),
      input.invitations.map((invitation) => invitation.specialty),
    );
  } catch (error) {
    return { ...settled, answer: null, refusal: refusalOf(error), checker: [], exchanges };
  }
  const checked = await checkAnswer(runtime, input.evidence, synthesis.answer, opinions);
  return {
    ...settled,
    ...checked,
    consilium: { ...consilium, agreements: synthesis.agreements },
    exchanges: [...exchanges, ...checked.exchanges],
  };
}
