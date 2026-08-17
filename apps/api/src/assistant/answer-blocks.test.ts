import assert from "node:assert/strict";
import test from "node:test";
import { AssistantAnswerError, parseAssistantAnswer } from "./answer-parser.js";

const observationA = "00000000-0000-4000-8000-00000000000a";
const context = {
  knownObservationIds: new Set([observationA]),
  knownRecordIds: new Set<string>(),
  profileValues: new Set(["4.9"]),
  interpretationReady: true,
};

function answer(blocks: readonly Record<string, unknown>[]) {
  return JSON.stringify({
    urgency: { tier: "routine", reasons: [{ observationId: observationA }] },
    blocks,
  });
}

const recommendation = {
  kind: "diet_recommendation",
  name: "Больше растворимой клетчатки",
  category: "favour",
  rationale: "Овёс, бобовые и овощи обычно помогают при таком значении A.",
  refs: [{ observationId: observationA }],
  interaction: "checked_clear",
  conflictNotes: null,
  confirmWith: "dietitian",
};

test("the nutritionist's blocks pass with their categories, interaction state and recheck", () => {
  const parsed = parseAssistantAnswer(
    answer([
      {
        kind: "diet_assessment",
        text: "Значение A выше напечатанного диапазона — рацион стоит пересмотреть.",
        refs: [{ observationId: observationA }],
      },
      recommendation,
      {
        ...recommendation,
        name: "Ограничить насыщенные жиры",
        category: "limit",
        interaction: "checked_conflict",
        conflictNotes: "В профиле записано лекарство, с которым это стоит обсудить.",
      },
      {
        kind: "recheck",
        text: "Повторить A после изменения рациона.",
        when: "через 3 месяца",
        refs: [{ observationId: observationA }],
      },
    ]),
    context,
  );
  assert.deepEqual(
    parsed.blocks.map((block) => block.kind),
    ["diet_assessment", "diet_recommendation", "diet_recommendation", "recheck"],
  );
  const limit = parsed.blocks[2];
  assert.ok(limit?.kind === "diet_recommendation");
  assert.equal(limit.category, "limit");
  assert.equal(limit.interaction, "checked_conflict");
  assert.equal(limit.confirmWith, "dietitian");
  const recheck = parsed.blocks[3];
  assert.ok(recheck?.kind === "recheck");
  assert.equal(recheck.when, "через 3 месяца");
});

test("a supplement with a dose is refused as prescriptive; a named class passes", () => {
  const parsed = parseAssistantAnswer(
    answer([
      {
        ...recommendation,
        name: "Витамин D 2000 МЕ в день",
        category: "supplement",
        rationale: "Обычная поддерживающая схема.",
      },
      {
        ...recommendation,
        name: "Препараты витамина D",
        category: "supplement",
        rationale: "Класс, который обычно обсуждают при таком значении A; дозу назначает врач.",
      },
    ]),
    context,
  );
  assert.deepEqual(
    parsed.blocks.map((block) => (block as { name: string }).name),
    ["Препараты витамина D"],
  );
  assert.throws(
    () =>
      parseAssistantAnswer(
        answer([{ ...recommendation, name: "Магний 400 мг", category: "supplement" }]),
        context,
      ),
    (error: unknown) =>
      error instanceof AssistantAnswerError && error.reason === "prescriptive_dose",
  );
});

test("a recheck or an assessment without a resolvable value is dropped; a recommendation may rest on the profile alone", () => {
  const stranger = "00000000-0000-4000-8000-0000000000ff";
  const parsed = parseAssistantAnswer(
    answer([
      { kind: "recheck", text: "Повторить A.", when: "через 3 месяца", refs: [] },
      {
        kind: "diet_assessment",
        text: "Оценка без опоры на значения.",
        refs: [{ observationId: stranger }],
      },
      { ...recommendation, refs: [] },
    ]),
    context,
  );
  assert.deepEqual(
    parsed.blocks.map((block) => block.kind),
    ["diet_recommendation"],
  );
});

test("the nutritionist's interpretive blocks need sex and birth year like the physician's", () => {
  const notReady = { ...context, interpretationReady: false };
  for (const block of [
    recommendation,
    { kind: "diet_assessment", text: "Оценка рациона.", refs: [{ observationId: observationA }] },
    {
      kind: "recheck",
      text: "Повторить A.",
      when: "через 3 месяца",
      refs: [{ observationId: observationA }],
    },
  ]) {
    assert.throws(
      () => parseAssistantAnswer(answer([block]), notReady),
      (error: unknown) =>
        error instanceof AssistantAnswerError && error.reason === "profile_not_ready",
    );
  }
  const parsed = parseAssistantAnswer(
    answer([{ kind: "missing", context: "height_weight" }]),
    notReady,
  );
  assert.deepEqual(parsed.blocks, [{ kind: "missing", context: "height_weight" }]);
});
