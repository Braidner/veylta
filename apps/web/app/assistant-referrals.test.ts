import assert from "node:assert/strict";
import test from "node:test";
import { ASSISTANT_DIET_CATEGORIES, ASSISTANT_MISSING_CONTEXTS } from "@veylta/contracts";
import { dietCategoryLabel, missingContextCopy } from "./assistant-block-copy";
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

const activity = {
  kind: "activity_recommendation" as const,
  name: "Быстрая ходьба",
  activityKind: "aerobic" as const,
  load: "3 раза в неделю по 30 минут в разговорном темпе",
  progression: "через 4 недели добавить 5–10 минут",
  rationale: "Умеренная аэробная нагрузка при таком значении A обычно уместна.",
  refs: [],
  clearance: "within" as const,
  conflictNotes: null,
  confirmWith: "physiotherapist" as const,
};

test("an activity within clearance goes into the activity lane with its load and progression", () => {
  assert.deepEqual(referralItem(activity), {
    category: "activity",
    title: "Быстрая ходьба",
    note: "Нагрузка: 3 раза в неделю по 30 минут в разговорном темпе. Прибавлять: через 4 недели добавить 5–10 минут. Подтвердить: физиотерапевт.",
    scheduledFor: null,
  });
  assert.deepEqual(referralActionCopy(activity), {
    label: "В план: активность",
    accepted: "Добавлено в план активности.",
  });
});

test("an activity that needs clearance becomes the visit that gives one, in the clinician lane", () => {
  const strength = {
    ...activity,
    name: "Силовые упражнения",
    activityKind: "strength" as const,
    progression: null,
    clearance: "needs_clearance" as const,
    conflictNotes: "В профиле нет записанного допуска к силовой нагрузке.",
    confirmWith: "cardiologist" as const,
  };
  const item = referralItem(strength);
  assert.equal(item.category, "clinician");
  assert.equal(item.title, "Получить допуск к нагрузке (кардиолог): Силовые упражнения");
  assert.match(item.note ?? "", /нет записанного допуска/);
  assert.deepEqual(referralActionCopy(strength), {
    label: "В план: получить допуск (кардиолог)",
    accepted: "Добавлено в план: получить допуск.",
  });
  assert.equal(isReferral(strength), true);
  assert.equal(
    isReferral({ ...activity, activityKind: "avoid", progression: null }),
    false,
    "a stop rule is kept in view, never filed",
  );
});
