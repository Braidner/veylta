import type {
  AssistantActivityKind,
  AssistantBlock,
  AssistantClearanceState,
  AssistantClinicianCheckClaim,
  AssistantConfidence,
  AssistantContraindicationState,
  AssistantDietCategory,
  AssistantMissingContext,
  AssistantTreatmentKind,
} from "@veylta/contracts";

export const confidenceLabel: Record<AssistantConfidence, string> = {
  low: "низкая уверенность",
  moderate: "умеренная уверенность",
  high: "высокая уверенность",
};

export const treatmentKindLabel: Record<AssistantTreatmentKind, string> = {
  lifestyle: "образ жизни",
  medication_class: "класс препаратов",
  medication: "препарат",
  procedure: "процедура",
  referral: "направление",
};

export const contraindicationCopy: Record<AssistantContraindicationState, string> = {
  checked_clear: "сверено с профилем: противопоказаний не найдено",
  checked_conflict: "сверено с профилем: есть конфликт",
  unknown: "в профиле не хватает данных для проверки",
};

/** The same three states for a diet recommendation, read against conditions and medications. */
export const interactionCopy: Record<AssistantContraindicationState, string> = {
  checked_clear: "сверено с профилем: взаимодействий не найдено",
  checked_conflict: "сверено с профилем: есть взаимодействие",
  unknown: "в профиле не хватает данных для проверки",
};

export const missingContextCopy: Record<AssistantMissingContext, string> = {
  sex: "Укажите пол в медицинском профиле — без него интерпретация не проводится.",
  birth_year: "Укажите год рождения в медицинском профиле — без него интерпретация не проводится.",
  medications: "Добавьте в профиль принимаемые лекарства — ответ учитывал бы их.",
  conditions: "Добавьте в профиль известные диагнозы — ответ учитывал бы их.",
  allergies: "Добавьте в профиль аллергии — ответ учитывал бы их.",
  symptoms: "Опишите в профиле жалобы и симптомы — ответ учитывал бы их.",
  recent_values: "Не хватает свежих значений: загрузите и подтвердите более новый анализ.",
  height_weight: "Укажите рост и вес в досье — без них план питания остаётся общим.",
  dietary_restrictions:
    "Добавьте в профиль ограничения в питании — диету, непереносимости, предпочтения; ответ учитывал бы их.",
  goals: "Добавьте в профиль цели — ответ учитывал бы их.",
  clearance:
    "В профиле нет допуска врача к нагрузке — запишите его, если он есть; иначе нагрузка остаётся осторожной.",
  activity_constraints:
    "Добавьте в профиль ограничения по нагрузке — травмы, операции, запреты врача; ответ учитывал бы их.",
};

/** What an activity recommendation is; the plan puts each into the activity lane. */
export const activityKindLabel: Record<AssistantActivityKind, string> = {
  aerobic: "аэробная нагрузка",
  strength: "силовая нагрузка",
  mobility: "подвижность и растяжка",
  recovery: "восстановление",
  avoid: "чего избегать и когда остановиться",
};

/** Whether the load sits within the person's clearance — a state, never a permission. */
export const clearanceCopy: Record<AssistantClearanceState, string> = {
  within: "в рамках допуска",
  needs_clearance: "нужен допуск врача",
  unknown: "допуск не записан — уточните",
};

/** The nutritionist's recommendation kinds — what a plan item is about, never how much. */
export const dietCategoryLabel: Record<AssistantDietCategory, string> = {
  structure: "структура рациона",
  favour: "добавить в рацион",
  limit: "ограничить",
  supplement: "добавка — без дозы",
  hydration: "питьевой режим",
  timing: "режим приёмов пищи",
};

export const blockKindLabel: Record<AssistantBlock["kind"], string> = {
  interpretation: "Что показывают значения",
  hypothesis: "Вероятное объяснение",
  treatment_option: "Что обычно рассматривает врач",
  clinician_check: "Сверка с записью врача",
  diet_assessment: "Что значения говорят о питании",
  diet_recommendation: "Рекомендация по питанию",
  activity_assessment: "Что значения говорят о нагрузке",
  activity_recommendation: "Рекомендация по нагрузке",
  recheck: "Что измерить снова",
  question: "Вопрос врачу",
  general: "Общая справка",
  missing: "Не хватает данных",
};

/** How the assistant's read stands to the clinician's record — a position, never a grade. */
export const clinicianCheckClaimCopy: Record<
  AssistantClinicianCheckClaim,
  { readonly label: string; readonly tone: "calm" | "watch" | "muted" }
> = {
  agree: { label: "Согласен с врачом", tone: "calm" },
  differs: { label: "Расходится — вопрос к визиту", tone: "watch" },
  cannot_assess: { label: "Не могу оценить по данным", tone: "muted" },
};
