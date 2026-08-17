import assert from "node:assert/strict";
import test from "node:test";
import { AssistantAnswerError, parseAssistantAnswer } from "./answer-parser.js";

const observationA = "00000000-0000-4000-8000-00000000000a";
const observationB = "00000000-0000-4000-8000-00000000000b";
const recordA = "00000000-0000-4000-8000-0000000000aa";
const context = {
  knownObservationIds: new Set([observationA, observationB]),
  knownRecordIds: new Set([recordA]),
  profileValues: new Set(["7.0", "12.5"]),
  interpretationReady: true,
};

function answer(overrides: Record<string, unknown>) {
  return JSON.stringify({
    urgency: { tier: "routine", reasons: [{ observationId: observationA }] },
    blocks: [],
    ...overrides,
  });
}

const hypothesis = {
  kind: "hypothesis",
  name: "Синтетическое состояние A",
  confidence: "moderate",
  rationale: "Значение A выше напечатанного диапазона при нормальном B.",
  refs: [{ observationId: observationA }],
  confirmWith: "therapist",
  workup: ["Повторить A через 4 недели"],
};

test("a well-formed answer keeps its blocks, its urgency and its referrals", () => {
  const parsed = parseAssistantAnswer(
    answer({
      blocks: [
        {
          kind: "interpretation",
          text: "Значение A выше диапазона источника.",
          refs: [{ observationId: observationA }],
        },
        hypothesis,
        {
          kind: "treatment_option",
          name: "Скорректировать образ жизни",
          treatmentKind: "lifestyle",
          rationale: "Общий первый шаг при таком отклонении.",
          refs: [{ observationId: observationA }],
          contraindications: "unknown",
          conflictNotes: null,
          confirmWith: "therapist",
        },
        { kind: "question", text: "Нужно ли повторить анализ A?", refs: [] },
        { kind: "general", text: "Показатель A отражает синтетический процесс." },
        { kind: "missing", context: "medications" },
      ],
    }),
    context,
  );
  assert.equal(parsed.urgency.tier, "routine");
  assert.deepEqual(
    parsed.blocks.map((block) => block.kind),
    ["interpretation", "hypothesis", "treatment_option", "question", "general", "missing"],
  );
});

test("a block whose evidence does not resolve is dropped; an answer with nothing left is refused", () => {
  const stranger = "00000000-0000-4000-8000-0000000000ff";
  const parsed = parseAssistantAnswer(
    answer({
      blocks: [
        { ...hypothesis, refs: [{ observationId: stranger }, { observationId: observationA }] },
        {
          kind: "interpretation",
          text: "Утверждение без единой опоры.",
          refs: [{ observationId: stranger }],
        },
      ],
    }),
    context,
  );
  assert.equal(parsed.blocks.length, 1);
  assert.deepEqual((parsed.blocks[0] as { refs: readonly { observationId: string }[] }).refs, [
    { observationId: observationA },
  ]);
  assert.throws(
    () =>
      parseAssistantAnswer(
        answer({
          blocks: [
            {
              kind: "interpretation",
              text: "Утверждение без единой опоры.",
              refs: [{ observationId: stranger }],
            },
          ],
        }),
        context,
      ),
    (error: unknown) =>
      error instanceof AssistantAnswerError && error.reason === "unbound_reference",
  );
});

test("urgency is mandatory and never lowered by bookkeeping", () => {
  assert.throws(
    () => parseAssistantAnswer(JSON.stringify({ blocks: [] }), context),
    (error: unknown) => error instanceof AssistantAnswerError && error.reason === "missing_urgency",
  );
  const parsed = parseAssistantAnswer(
    answer({
      urgency: {
        tier: "emergency",
        reasons: [{ observationId: "00000000-0000-4000-8000-0000000000ff" }],
      },
    }),
    context,
  );
  assert.equal(parsed.urgency.tier, "emergency");
  assert.deepEqual(parsed.urgency.reasons, []);
});

test("a medication option with a dose is refused as prescriptive; classes and lifestyle pass", () => {
  const parsed = parseAssistantAnswer(
    answer({
      blocks: [
        {
          kind: "treatment_option",
          name: "Синтетический препарат A 500 мг 2 раза в день",
          treatmentKind: "medication",
          rationale: "Обычная схема.",
          refs: [{ observationId: observationA }],
          contraindications: "checked_clear",
          conflictNotes: null,
          confirmWith: "therapist",
        },
        {
          kind: "treatment_option",
          name: "Препараты класса A",
          treatmentKind: "medication_class",
          rationale: "Класс, который обычно рассматривают при таком отклонении.",
          refs: [{ observationId: observationA }],
          contraindications: "unknown",
          conflictNotes: null,
          confirmWith: "therapist",
        },
      ],
    }),
    context,
  );
  assert.deepEqual(
    parsed.blocks.map((block) => (block as { name: string }).name),
    ["Препараты класса A"],
  );
});

test("a general block that quotes the profile's own numbers is not general", () => {
  const parsed = parseAssistantAnswer(
    answer({
      blocks: [
        { kind: "general", text: "Значение 7.0 обычно означает синтетическую перегрузку." },
        { kind: "general", text: "Показатель A измеряет синтетический процесс." },
      ],
    }),
    context,
  );
  assert.equal(parsed.blocks.length, 1);
});

test("without sex and birth year only missing and general blocks are accepted", () => {
  const notReady = { ...context, interpretationReady: false };
  const parsed = parseAssistantAnswer(
    answer({
      blocks: [
        { kind: "missing", context: "sex" },
        { kind: "general", text: "Что такое показатель A: общая справка." },
      ],
    }),
    notReady,
  );
  assert.equal(parsed.blocks.length, 2);
  assert.throws(
    () => parseAssistantAnswer(answer({ blocks: [hypothesis] }), notReady),
    (error: unknown) =>
      error instanceof AssistantAnswerError && error.reason === "profile_not_ready",
  );
});

test("Latin-only prose is refused as not Russian", () => {
  assert.throws(
    () =>
      parseAssistantAnswer(
        answer({
          blocks: [{ kind: "general", text: "Marker A reflects a synthetic process." }],
        }),
        context,
      ),
    (error: unknown) => error instanceof AssistantAnswerError && error.reason === "not_russian",
  );
});

test("a сверка block binds to a confirmed clinician record; an unknown record or an unbound view is dropped", () => {
  const check = (overrides: Record<string, unknown>) => ({
    kind: "clinician_check",
    claim: "differs",
    theirs: { recordId: recordA },
    ours: "По вашим значениям картина ближе к норме.",
    why: "Значение A в пределах напечатанного диапазона.",
    refs: [{ observationId: observationA }],
    confirmWith: "endocrinologist",
    ...overrides,
  });
  const parsed = parseAssistantAnswer(
    answer({
      blocks: [
        check({}),
        check({ theirs: { recordId: "00000000-0000-4000-8000-0000000000ff" } }),
        check({ claim: "agree", refs: [] }),
        check({ claim: "cannot_assess", refs: [] }),
      ],
    }),
    context,
  );
  assert.deepEqual(
    parsed.blocks.map((block) => (block.kind === "clinician_check" ? block.claim : block.kind)),
    ["differs", "cannot_assess"],
  );
  const kept = parsed.blocks[0];
  assert.ok(kept?.kind === "clinician_check");
  assert.equal(kept.theirs.recordId, recordA);
  assert.equal(kept.confirmWith, "endocrinologist");
  assert.throws(
    () =>
      parseAssistantAnswer(answer({ blocks: [check({})] }), {
        ...context,
        interpretationReady: false,
      }),
    (error: unknown) =>
      error instanceof AssistantAnswerError && error.reason === "profile_not_ready",
  );
});
