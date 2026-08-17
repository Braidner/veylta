import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantAnswer } from "@veylta/contracts";
import { applyCheckerVerdicts, parseCheckerVerdicts } from "./answer-checker.js";

const observationA = "00000000-0000-4000-8000-00000000000a";
const answer: AssistantAnswer = {
  urgency: { tier: "routine", reasons: [{ observationId: observationA }] },
  blocks: [
    {
      kind: "hypothesis",
      name: "Синтетическое состояние A",
      confidence: "high",
      rationale: "Опора на значение A.",
      refs: [{ observationId: observationA }],
      confirmWith: "therapist",
      workup: [],
    },
    { kind: "general", text: "Общая справка о показателе A." },
    {
      kind: "treatment_option",
      name: "Смена образа жизни",
      treatmentKind: "lifestyle",
      rationale: "Первый шаг.",
      refs: [{ observationId: observationA }],
      contraindications: "unknown",
      conflictNotes: null,
      confirmWith: "therapist",
    },
  ],
};

test("the checker lowers overreach, drops what it contradicts, and never lowers the alarm", () => {
  const verdicts = parseCheckerVerdicts(
    JSON.stringify({
      verdicts: [
        {
          blockIndex: 0,
          verdict: "overreach",
          note: "Один показатель — мало для высокой уверенности.",
        },
        { blockIndex: 2, verdict: "contradicted", note: null },
      ],
      urgency: "soon",
    }),
    answer.blocks.length,
  );
  const applied = applyCheckerVerdicts(answer, verdicts);
  assert.ok(applied !== null);
  assert.equal(applied.urgency.tier, "soon");
  assert.deepEqual(
    applied.blocks.map((block) => block.kind),
    ["hypothesis", "general"],
  );
  assert.equal((applied.blocks[0] as { confidence: string }).confidence, "moderate");

  const lowerRead = parseCheckerVerdicts(
    JSON.stringify({ verdicts: [], urgency: "none" }),
    answer.blocks.length,
  );
  assert.equal(applyCheckerVerdicts(answer, lowerRead)?.urgency.tier, "routine");
});

test("an answer the checker rejects entirely yields nothing to show", () => {
  const verdicts = parseCheckerVerdicts(
    JSON.stringify({
      verdicts: [0, 1, 2].map((blockIndex) => ({ blockIndex, verdict: "unsafe", note: null })),
      urgency: "routine",
    }),
    answer.blocks.length,
  );
  assert.equal(applyCheckerVerdicts(answer, verdicts), null);
});

test("a verdict for a block that does not exist is dropped, not fatal", () => {
  const verdicts = parseCheckerVerdicts(
    JSON.stringify({
      verdicts: [
        { blockIndex: 7, verdict: "unsafe", note: null },
        { blockIndex: 1, verdict: "supported", note: null },
      ],
      urgency: "routine",
    }),
    answer.blocks.length,
  );
  assert.deepEqual(
    verdicts.verdicts.map((verdict) => verdict.blockIndex),
    [1],
  );
});
