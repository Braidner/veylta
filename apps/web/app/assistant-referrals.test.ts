import assert from "node:assert/strict";
import test from "node:test";
import { ASSISTANT_DIET_CATEGORIES, ASSISTANT_MISSING_CONTEXTS } from "@veylta/contracts";
import { dietCategoryLabel, missingContextCopy } from "./assistant";
import { isReferral, referralActionCopy, referralItem, referralsOf } from "./assistant-referrals";

const recommendation = {
  kind: "diet_recommendation" as const,
  name: "Больше растворимой клетчатки",
  category: "favour" as const,
  rationale: "Овёс, бобовые и овощи обычно помогают при таком значении A.",
  refs: [],
  interaction: "checked_clear" as const,
  conflictNotes: null,
  confirmWith: "dietitian" as const,
};
const recheck = {
  kind: "recheck" as const,
  text: "Повторить синтетический показатель A после изменения рациона.",
  when: "через 3 месяца",
  refs: [],
};

test("a diet recommendation goes into the nutrition lane with its caveat and who confirms it", () => {
  assert.deepEqual(referralItem(recommendation), {
    category: "nutrition",
    title: "Больше растворимой клетчатки",
    note: "Овёс, бобовые и овощи обычно помогают при таком значении A. Подтвердить: диетолог.",
    scheduledFor: null,
  });
  const flagged = referralItem({
    ...recommendation,
    interaction: "checked_conflict",
    conflictNotes: "В профиле записано лекарство, с которым это стоит обсудить.",
    confirmWith: "therapist",
  });
  assert.equal(
    flagged.note,
    "Овёс, бобовые и овощи обычно помогают при таком значении A. Внимание: В профиле записано лекарство, с которым это стоит обсудить. Подтвердить: терапевт.",
  );
  assert.deepEqual(referralActionCopy(recommendation), {
    label: "В план: питание",
    accepted: "Добавлено в план питания.",
  });
});

test("a recheck goes into the laboratory lane with the assistant's phrase, never a computed date", () => {
  assert.deepEqual(referralItem(recheck), {
    category: "laboratory",
    title: "Повторить синтетический показатель A после изменения рациона.",
    note: "Когда: через 3 месяца.",
    scheduledFor: null,
  });
  assert.deepEqual(referralActionCopy(recheck), {
    label: "В план: повторить анализ",
    accepted: "Добавлено в план: повторить анализ.",
  });
});

test("diet recommendations and rechecks are referrals; assessments, questions and missing are not", () => {
  const referrals = referralsOf({
    urgency: { tier: "routine", reasons: [] },
    blocks: [
      { kind: "diet_assessment", text: "Рацион стоит пересмотреть.", refs: [] },
      recommendation,
      recheck,
      { kind: "question", text: "Что вы едите чаще всего?", refs: [] },
      { kind: "missing", context: "height_weight" },
    ],
  });
  assert.deepEqual(
    referrals.map((block) => block.kind),
    ["diet_recommendation", "recheck"],
  );
  assert.equal(isReferral({ kind: "general", text: "Справка." }), false);
});

test("every diet category and missing context has fixed Russian copy", () => {
  for (const category of ASSISTANT_DIET_CATEGORIES) {
    assert.match(dietCategoryLabel[category], /[а-яё]/i);
  }
  for (const context of ASSISTANT_MISSING_CONTEXTS) {
    assert.match(missingContextCopy[context], /[а-яё]/i);
  }
  assert.match(dietCategoryLabel.supplement, /без дозы/);
});
