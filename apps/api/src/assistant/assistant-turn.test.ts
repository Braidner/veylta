import assert from "node:assert/strict";
import test from "node:test";
import { needsChecker, runPhysicianTurn } from "./assistant-turn.js";
import {
  type AssistantRuntime,
  AssistantRuntimeError,
  type AssistantRuntimeTurn,
} from "./codex-assistant-runtime.js";
import type { AssistantEvidence } from "./evidence.js";

const observationA = "00000000-0000-4000-8000-00000000000a";
const threadId = "11111111-1111-4111-8111-111111111111";

const evidence: AssistantEvidence = {
  medicalProfile: {
    interpretationReady: true,
    entries: [
      { kind: "sex", value: "female", recordedOn: null },
      { kind: "birth_year", value: "1990", recordedOn: null },
    ],
  },
  observations: [
    {
      observationId: observationA,
      code: "synthetic-analyte-a",
      name: "SYNTHETIC ANALYTE A",
      value: "7.0",
      unit: "synthetic-unit",
      referenceRange: { text: "synthetic reference", low: null, high: null, laboratoryFlag: null },
      sampledAt: "2026-08-10T08:00:00.000Z",
      laboratory: null,
    },
  ],
  clinicianRecords: [],
  carePlan: [],
};

const answer = {
  urgency: { tier: "routine", reasons: [{ observationId: observationA }] },
  blocks: [
    {
      kind: "interpretation",
      text: "Значение A выше диапазона источника.",
      refs: [{ observationId: observationA }],
    },
    {
      kind: "hypothesis",
      name: "Синтетическое состояние A",
      confidence: "high",
      rationale: "Значение A выше напечатанного диапазона.",
      refs: [{ observationId: observationA }],
      confirmWith: "therapist",
      workup: ["Повторить A"],
    },
  ],
};

function scripted(responses: readonly (string | Error)[]): {
  runtime: AssistantRuntime;
  turns: AssistantRuntimeTurn[];
} {
  const turns: AssistantRuntimeTurn[] = [];
  const queue = [...responses];
  return {
    turns,
    runtime: {
      async run(turn) {
        turns.push(turn);
        const next = queue.shift();
        if (next === undefined) throw new Error("unexpected runtime call");
        if (next instanceof Error) throw next;
        return {
          threadId: turn.threadId ?? threadId,
          output: next,
          modelId: "gpt-test",
          runtimeVersion: "codex-cli 0.147.0",
          durationMs: 12,
        };
      },
    },
  };
}

test("an answer is verified, refuted by the checker and kept where it survives", async () => {
  const { runtime, turns } = scripted([
    JSON.stringify(answer),
    JSON.stringify({
      verdicts: [
        { blockIndex: 0, verdict: "supported", note: null },
        { blockIndex: 1, verdict: "overreach", note: "Одного значения мало для уверенности." },
      ],
      urgency: "soon",
    }),
  ]);
  const outcome = await runPhysicianTurn(runtime, {
    threadId: null,
    evidence,
    evidenceChanged: true,
    message: "Что значат мои анализы?",
  });
  assert.equal(outcome.refusal, null);
  assert.equal(outcome.threadId, threadId);
  assert.equal(outcome.answer?.urgency.tier, "soon");
  assert.equal(outcome.answer?.blocks.length, 2);
  const hypothesis = outcome.answer?.blocks[1];
  assert.equal(hypothesis?.kind === "hypothesis" ? hypothesis.confidence : null, "moderate");
  assert.equal(outcome.checker.length, 2);
  assert.deepEqual(
    outcome.exchanges.map((item) => item.stage),
    ["answer", "checker"],
  );
  assert.equal(turns[0]?.threadId, null);
  assert.match(turns[0]?.prompt ?? "", /The person writes:\nЧто значат мои анализы\?$/);
  assert.equal(turns[1]?.threadId, null, "the checker never shares the physician's thread");
});

test("a follow-up resumes the thread and re-sends the evidence only when it changed", async () => {
  const { runtime, turns } = scripted([
    JSON.stringify({ urgency: { tier: "none", reasons: [] }, blocks: [] }),
    JSON.stringify({ urgency: { tier: "none", reasons: [] }, blocks: [] }),
  ]);
  await runPhysicianTurn(runtime, { threadId, evidence, evidenceChanged: false, message: "Ещё" });
  await runPhysicianTurn(runtime, { threadId, evidence, evidenceChanged: true, message: "Ещё" });
  assert.equal(turns[0]?.threadId, threadId);
  assert.doesNotMatch(turns[0]?.prompt ?? "", /Updated evidence/);
  assert.match(turns[1]?.prompt ?? "", /Updated evidence/);
});

test("a model failure is a refusal with its exchange, never an exception", async () => {
  const { runtime } = scripted([new AssistantRuntimeError("gpt-test", 5, new Error("down"))]);
  const outcome = await runPhysicianTurn(runtime, {
    threadId: null,
    evidence,
    evidenceChanged: true,
    message: "Привет",
  });
  assert.equal(outcome.refusal, "provider_unavailable");
  assert.equal(outcome.answer, null);
  assert.equal(outcome.exchanges[0]?.responseText, "");
  assert.equal(outcome.exchanges[0]?.runtimeVersion, null);
});

test("an answer the checker refutes entirely is refused as checker_unsafe", async () => {
  const { runtime } = scripted([
    JSON.stringify(answer),
    JSON.stringify({
      verdicts: [
        { blockIndex: 0, verdict: "contradicted", note: null },
        { blockIndex: 1, verdict: "unsafe", note: "Опасно." },
      ],
      urgency: "none",
    }),
  ]);
  const outcome = await runPhysicianTurn(runtime, {
    threadId: null,
    evidence,
    evidenceChanged: true,
    message: "?",
  });
  assert.equal(outcome.refusal, "checker_unsafe");
  assert.equal(outcome.answer, null);
  assert.equal(outcome.checker.length, 2, "the owner still sees why");
});

test("a missing-only answer for an unready profile skips the checker", async () => {
  const unready = {
    ...evidence,
    medicalProfile: { interpretationReady: false, entries: [] },
  };
  const { runtime, turns } = scripted([
    JSON.stringify({
      urgency: { tier: "none", reasons: [] },
      blocks: [
        { kind: "missing", context: "sex" },
        { kind: "missing", context: "birth_year" },
      ],
    }),
  ]);
  const outcome = await runPhysicianTurn(runtime, {
    threadId: null,
    evidence: unready,
    evidenceChanged: true,
    message: "?",
  });
  assert.equal(outcome.refusal, null);
  assert.equal(outcome.answer?.blocks.length, 2);
  assert.equal(turns.length, 1);
  assert.equal(
    needsChecker(outcome.answer ?? { urgency: { tier: "none", reasons: [] }, blocks: [] }),
    false,
  );
});

test("a shape the parser refuses becomes that closed reason", async () => {
  const { runtime } = scripted(["not json"]);
  const outcome = await runPhysicianTurn(runtime, {
    threadId: null,
    evidence,
    evidenceChanged: true,
    message: "?",
  });
  assert.equal(outcome.refusal, "schema_shape");
  assert.equal(outcome.exchanges[0]?.responseText, "not json");
});
