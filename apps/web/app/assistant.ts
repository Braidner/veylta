import type {
  AssistantAnswer,
  AssistantBlock,
  AssistantCheckerVerdict,
  AssistantConfidence,
  AssistantContraindicationState,
  AssistantMissingContext,
  AssistantRejectionReason,
  AssistantSpecialty,
  AssistantTreatmentKind,
  AssistantUrgencyTier,
  CarePlanItemCreateRequest,
} from "@veylta/contracts";
import { ApiError } from "./api-client";
import { countCopy } from "./russian-plural";

export const assistantTitle = "ИИ-врач · второе мнение";
export const assistantIntro =
  "Разбирает только подтверждённые значения с учётом вашего медицинского профиля, называет вероятные объяснения и варианты, которые обычно рассматривает врач. Каждый вывод — рекомендация для разговора с врачом, а не диагноз и не назначение.";

/** Fixed copy per tier; the model's own words never become the alarm. */
export const urgencyCopy: Record<
  AssistantUrgencyTier,
  { readonly label: string; readonly copy: string; readonly tone: "calm" | "watch" | "alarm" }
> = {
  none: {
    label: "Срочных действий нет",
    copy: "По этим данным неотложных шагов не видно. Ответ ниже — для планового обсуждения.",
    tone: "calm",
  },
  routine: {
    label: "Обсудите на плановом визите",
    copy: "Возьмите этот разбор на ближайший запланированный приём.",
    tone: "calm",
  },
  soon: {
    label: "Запишитесь к врачу в ближайшие недели",
    copy: "Ждать следующего планового визита не стоит: покажите значения врачу в ближайшие недели.",
    tone: "watch",
  },
  urgent: {
    label: "Покажитесь врачу в ближайшие дни",
    copy: "Эти значения стоит показать врачу в ближайшие дни, не откладывая.",
    tone: "watch",
  },
  emergency: {
    label: "Обратитесь за неотложной помощью сейчас",
    copy: "Данные могут означать непосредственную опасность. Вызовите скорую или обратитесь в приёмное отделение — не ждите ответа здесь.",
    tone: "alarm",
  },
};

/** Why an answer was withheld — a closed reason rendered as fixed copy, never a model sentence. */
export const refusalCopy: Record<AssistantRejectionReason, string> = {
  schema_shape: "Ответ пришёл не в ожидаемой форме, и мы его не показываем.",
  not_russian: "Ответ пришёл не на русском языке, и мы его не показываем.",
  unbound_reference: "Ни один вывод не опирался на ваши подтверждённые значения — ответ отклонён.",
  missing_urgency: "Ответ не назвал степень срочности — такой ответ мы не показываем.",
  prescriptive_dose:
    "Ответ содержал дозировку лекарства. Дозы назначает только врач; ответ отклонён.",
  general_names_values: "Общая справка цитировала ваши значения — ответ отклонён.",
  checker_unsafe: "Проверяющий запуск не подтвердил ни одного вывода — ответ отклонён.",
  profile_not_ready: "Без пола и года рождения в медицинском профиле интерпретация не проводится.",
  response_too_large: "Ответ оказался слишком длинным для проверки, и мы его не показываем.",
  provider_unavailable:
    "Codex не ответил. Сообщение сохранено — отправьте новое, когда Codex снова доступен.",
};

export const specialtyLabel: Record<AssistantSpecialty, string> = {
  therapist: "терапевт",
  endocrinologist: "эндокринолог",
  cardiologist: "кардиолог",
  gastroenterologist: "гастроэнтеролог",
  hematologist: "гематолог",
  nephrologist: "нефролог",
  gynecologist: "гинеколог",
  urologist: "уролог",
  neurologist: "невролог",
  dermatologist: "дерматолог",
  pulmonologist: "пульмонолог",
  rheumatologist: "ревматолог",
  oncologist: "онколог",
  infectious_disease: "инфекционист",
  dietitian: "диетолог",
  physiotherapist: "физиотерапевт",
  psychiatrist: "психиатр",
  other: "профильный специалист",
};

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

export const missingContextCopy: Record<AssistantMissingContext, string> = {
  sex: "Укажите пол в медицинском профиле — без него интерпретация не проводится.",
  birth_year: "Укажите год рождения в медицинском профиле — без него интерпретация не проводится.",
  medications: "Добавьте в профиль принимаемые лекарства — ответ учитывал бы их.",
  conditions: "Добавьте в профиль известные диагнозы — ответ учитывал бы их.",
  allergies: "Добавьте в профиль аллергии — ответ учитывал бы их.",
  symptoms: "Опишите в профиле жалобы и симптомы — ответ учитывал бы их.",
  recent_values: "Не хватает свежих значений: загрузите и подтвердите более новый анализ.",
};

export const checkerVerdictLabel: Record<AssistantCheckerVerdict, string> = {
  supported: "подтверждено",
  overreach: "уверенность снижена",
  contradicted: "опровергнуто",
  unsafe: "небезопасно",
};

export const blockKindLabel: Record<AssistantBlock["kind"], string> = {
  interpretation: "Что показывают значения",
  hypothesis: "Вероятное объяснение",
  treatment_option: "Что обычно рассматривает врач",
  question: "Вопрос врачу",
  general: "Общая справка",
  missing: "Не хватает данных",
};

/** What the egress notice promises — the same items the server's evidence loader sends. */
export function egressDisclosure(input: {
  readonly evidenceCount: number;
  readonly interpretationReady: boolean;
}): readonly string[] {
  return [
    `${countCopy(input.evidenceCount, ["подтверждённое значение", "подтверждённых значения", "подтверждённых значений"])} с напечатанными референсами, датами и лабораторией`,
    input.interpretationReady
      ? "записи медицинского профиля: пол, год рождения и всё, что вы добавили"
      : "записи медицинского профиля (пол и год рождения пока не указаны — интерпретации не будет)",
    "принятые и предложенные пункты плана",
  ];
}

/** Accepting a referral: one clinician item, phrased from the block, for the care plan. */
export function referralItem(
  block: Extract<AssistantBlock, { kind: "hypothesis" | "treatment_option" }>,
): CarePlanItemCreateRequest {
  const specialty = specialtyLabel[block.confirmWith];
  const title = `Подтвердить у специалиста (${specialty}): ${block.name}`.slice(0, 120);
  return {
    category: "clinician",
    title,
    note: block.rationale.slice(0, 500),
    scheduledFor: null,
  };
}

export function referralsOf(answer: AssistantAnswer) {
  return answer.blocks.filter(
    (block): block is Extract<AssistantBlock, { kind: "hypothesis" | "treatment_option" }> =>
      block.kind === "hypothesis" || block.kind === "treatment_option",
  );
}

export function assistantSendErrorCopy(error: unknown): string {
  if (error instanceof ApiError && error.code === "ACKNOWLEDGEMENT_REQUIRED") {
    return "Сначала подтвердите отправку данных в Codex.";
  }
  if (error instanceof ApiError && error.status === 409) {
    return "В этом диалоге больше нельзя отправлять сообщения — создайте новый.";
  }
  return "Не удалось получить ответ. Проверьте соединение и повторите отправку.";
}

export function assistantCreateErrorCopy(error: unknown): string {
  return error instanceof ApiError && error.status === 409
    ? "Нельзя создать больше 20 диалогов для одного профиля."
    : "Не удалось создать диалог. Проверьте соединение и повторите.";
}
