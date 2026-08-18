import type {
  AssistantAgreementVerdict,
  AssistantCheckerVerdict,
  AssistantId,
  AssistantRejectionReason,
  AssistantSpecialty,
  AssistantUrgencyTier,
} from "@veylta/contracts";
import { countCopy } from "./russian-plural";

/** Who answers in each room, in the cases the copy needs; the rule each one is held to. */
export const assistantIdentity: Record<
  AssistantId,
  {
    readonly title: string;
    readonly name: string;
    readonly dative: string;
    readonly instrumental: string;
    readonly rule: string;
    readonly hint: string;
    readonly placeholder: string;
  }
> = {
  physician: {
    title: "ИИ-врач · второе мнение",
    name: "ИИ-врач",
    dative: "ИИ-врачу",
    instrumental: "ИИ-врачом",
    rule: "Разбирает только подтверждённые значения с учётом вашего профиля. Каждый вывод — рекомендация для разговора с врачом, а не диагноз и не назначение.",
    hint: "Читает все подтверждённые значения и ваш профиль; каждый вывод — рекомендация для разговора с врачом.",
    placeholder: "Например: что означают мои последние анализы?",
  },
  nutritionist: {
    title: "ИИ-нутрициолог · питание по вашим данным",
    name: "ИИ-нутрициолог",
    dative: "ИИ-нутрициологу",
    instrumental: "ИИ-нутрициологом",
    rule: "Оценивает рацион по подтверждённым значениям и профилю: что усилить, что ограничить, что сверить с врачом. Добавки — по названию, без доз; каждый пункт подтверждает диетолог или врач.",
    hint: "Читает подтверждённые значения, ваш профиль (лекарства, диагнозы, аллергии, ограничения, цели) и принятый план; каждый пункт — рекомендация, не назначение.",
    placeholder: "Например: как мне питаться при таких значениях?",
  },
  trainer: {
    title: "ИИ-тренер · нагрузка по вашим данным",
    name: "ИИ-тренер",
    dative: "ИИ-тренеру",
    instrumental: "ИИ-тренером",
    rule: "Оценивает нагрузку по подтверждённым значениям, ограничениям, допуску и вашим отметкам в плане: что делать, сколько, как прибавлять и когда остановиться. Каждый пункт подтверждает физиотерапевт или врач.",
    hint: "Читает подтверждённые значения, ваш профиль (диагнозы, лекарства, ограничения по нагрузке, допуск, цели), принятый план и ваши отметки по нему; каждый пункт — рекомендация, не назначение.",
    placeholder: "Например: как мне тренироваться при таких значениях?",
  },
};

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
  emergency: "неотложная помощь",
  other: "профильный специалист",
};

export const checkerVerdictLabel: Record<AssistantCheckerVerdict, string> = {
  supported: "подтверждено",
  overreach: "уверенность снижена",
  contradicted: "опровергнуто",
  unsafe: "небезопасно",
};

export const agreementVerdictLabel: Record<AssistantAgreementVerdict, string> = {
  agree: "сходятся",
  differ: "расходятся",
};

/** Who is speaking in the conversation: the room's own assistant or one persona. */
export function speakerLabel(
  specialty: AssistantSpecialty | null,
  assistantId: AssistantId,
): string {
  if (specialty === null) return assistantIdentity[assistantId].name;
  return `ИИ-${specialtyLabel[specialty]}`;
}

/** What the egress notice promises — the same items the server's evidence loader sends. */
export function egressDisclosure(input: {
  readonly evidenceCount: number;
  readonly interpretationReady: boolean;
  readonly recordCount: number;
}): readonly string[] {
  return [
    `${countCopy(input.evidenceCount, ["подтверждённое значение", "подтверждённых значения", "подтверждённых значений"])} с напечатанными референсами, датами и лабораторией`,
    ...(input.recordCount > 0
      ? [
          `${countCopy(input.recordCount, ["подтверждённая запись врача", "подтверждённые записи врача", "подтверждённых записей врача"])} — диагнозы, назначения, направления, как вы их подтвердили`,
        ]
      : []),
    input.interpretationReady
      ? "записи медицинского профиля: пол, год рождения и всё, что вы добавили"
      : "записи медицинского профиля (пол и год рождения пока не указаны — интерпретации не будет)",
    "принятые и предложенные пункты плана и ваши отметки по ним за последние 4 недели",
  ];
}
