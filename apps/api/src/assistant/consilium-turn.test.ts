import assert from "node:assert/strict";
import test from "node:test";
import {
  type AssistantRuntime,
  AssistantRuntimeError,
  type AssistantRuntimeTurn,
} from "./codex-assistant-runtime.js";
import { runConsiliumTurn } from "./consilium-turn.js";
import type { AssistantEvidence } from "./evidence.js";

const tsh = "00000000-0000-4000-8000-0000000000a1";
const hb = "00000000-0000-4000-8000-0000000000b1";
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
      observationId: tsh,
      code: "tsh",
      name: "ТТГ",
      value: "6.8",
      unit: "мМЕ/л",
      referenceRange: null,
      sampledAt: null,
      laboratory: null,
    },
    {
      observationId: hb,
      code: "hemoglobin",
      name: "Гемоглобин",
      value: "9.8",
      unit: "г/дл",
      referenceRange: null,
      sampledAt: null,
      laboratory: null,
    },
  ],
  carePlan: [],
};
const invitations = [
  { specialty: "endocrinologist" as const, observationIds: [tsh] },
  { specialty: "hematologist" as const, observationIds: [hb] },
];

function opinion(tier: string, name: string, ref: string) {
  return JSON.stringify({
    urgency: { tier, reasons: [{ observationId: ref }] },
    blocks: [
      {
        kind: "hypothesis",
        name,
        confidence: "moderate",
        rationale: "Значение вне напечатанного диапазона.",
        refs: [{ observationId: ref }],
        confirmWith: "therapist",
        workup: [],
      },
    ],
  });
}
const supported = (count: number) =>
  JSON.stringify({
    verdicts: Array.from({ length: count }, (_, blockIndex) => ({
      blockIndex,
      verdict: "supported",
      note: null,
    })),
    urgency: "routine",
  });

/** Answers by what the prompt is: a persona (its `Specialty:` line), a synthesis, or the checker. */
function scripted(script: {
  readonly opinions: Record<string, string | Error>;
  readonly synthesis: string | Error;
  readonly checkerUrgency?: string;
}): { runtime: AssistantRuntime; turns: AssistantRuntimeTurn[] } {
  const turns: AssistantRuntimeTurn[] = [];
  return {
    turns,
    runtime: {
      async run(turn) {
        turns.push(turn);
        const schema = turn.schema as { properties: Record<string, unknown> };
        let output: string | Error;
        if (schema.properties.verdicts !== undefined) {
          const answer = JSON.parse(turn.prompt.slice(turn.prompt.lastIndexOf("\n") + 1)) as {
            blocks: unknown[];
          };
          output = supported(answer.blocks.length).replace(
            '"urgency":"routine"',
            `"urgency":"${script.checkerUrgency ?? "routine"}"`,
          );
        } else if (schema.properties.agreements !== undefined) {
          output = script.synthesis;
        } else {
          const specialty = /^Specialty: (\w+)$/m.exec(turn.prompt)?.[1] ?? "";
          output = script.opinions[specialty] ?? new Error(`no opinion for ${specialty}`);
        }
        if (output instanceof Error) throw output;
        return {
          threadId: turn.threadId ?? threadId,
          output,
          modelId: "gpt-test",
          runtimeVersion: "codex-cli 0.147.0",
          durationMs: 3,
        };
      },
    },
  };
}

test("every persona reads the evidence, the therapist synthesises, the checker refutes the synthesis", async () => {
  const synthesis = JSON.stringify({
    urgency: { tier: "soon", reasons: [{ observationId: tsh }] },
    blocks: [
      {
        kind: "interpretation",
        text: "ТТГ и гемоглобин вне напечатанных диапазонов.",
        refs: [{ observationId: tsh }, { observationId: hb }],
      },
    ],
    agreements: [
      {
        topic: "Срочность",
        verdict: "differ",
        specialties: ["endocrinologist", "hematologist"],
        why: "Эндокринолог зовёт в ближайшие недели, гематолог — планово.",
      },
    ],
  });
  const { runtime, turns } = scripted({
    opinions: {
      endocrinologist: opinion("soon", "Синтетический субклинический гипотиреоз", tsh),
      hematologist: opinion("routine", "Синтетическая лёгкая анемия", hb),
    },
    synthesis,
  });
  const outcome = await runConsiliumTurn(runtime, {
    threadId: null,
    evidence,
    evidenceChanged: true,
    invitations,
    question: "Что вы думаете?",
  });
  assert.equal(outcome.refusal, null);
  assert.equal(outcome.threadId, threadId, "the synthesis opens the therapist's thread");
  assert.equal(outcome.answer?.urgency.tier, "soon");
  assert.deepEqual(
    outcome.consilium?.opinions.map((item) => [item.specialty, item.answer?.urgency.tier]),
    [
      ["endocrinologist", "soon"],
      ["hematologist", "routine"],
    ],
  );
  assert.equal(outcome.consilium?.agreements[0]?.verdict, "differ");
  assert.deepEqual(
    outcome.exchanges.map((item) => `${item.stage}:${item.specialty ?? "-"}`),
    [
      "opinion:endocrinologist",
      "checker:endocrinologist",
      "opinion:hematologist",
      "checker:hematologist",
      "synthesis:-",
      "checker:-",
    ],
  );
  const synthesisTurn = turns.find((turn) => /agreements/.test(JSON.stringify(turn.schema)));
  assert.match(synthesisTurn?.prompt ?? "", /physician assistant/, "a new thread hears the role");
  assert.match(synthesisTurn?.prompt ?? "", /Что вы думаете\?/);
});

test("one persona failing does not sink the консилиум; all failing refuses it", async () => {
  const partial = scripted({
    opinions: {
      endocrinologist: opinion("soon", "Синтетический субклинический гипотиреоз", tsh),
      hematologist: new AssistantRuntimeError("gpt-test", 1, new Error("down")),
    },
    synthesis: JSON.stringify({
      urgency: { tier: "soon", reasons: [{ observationId: tsh }] },
      blocks: [{ kind: "general", text: "Общая справка о синтетическом показателе." }],
      agreements: [],
    }),
  });
  const outcome = await runConsiliumTurn(partial.runtime, {
    threadId,
    evidence,
    evidenceChanged: false,
    invitations,
    question: null,
  });
  assert.equal(outcome.refusal, null);
  assert.equal(outcome.consilium?.opinions[1]?.refusal, "provider_unavailable");
  assert.equal(outcome.consilium?.opinions[0]?.answer?.blocks.length, 1);

  const none = scripted({
    opinions: {
      endocrinologist: new AssistantRuntimeError("gpt-test", 1, new Error("down")),
      hematologist: new AssistantRuntimeError("gpt-test", 1, new Error("down")),
    },
    synthesis: "unused",
  });
  const refused = await runConsiliumTurn(none.runtime, {
    threadId,
    evidence,
    evidenceChanged: false,
    invitations,
    question: null,
  });
  assert.equal(refused.refusal, "provider_unavailable");
  assert.equal(none.turns.length, 2, "no synthesis without a single opinion");
  assert.equal(refused.consilium?.opinions.length, 2, "the person still sees who was asked");
});
