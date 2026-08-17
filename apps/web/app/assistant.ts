import type {
  AssistantAgreementVerdict,
  AssistantAnswer,
  AssistantBlock,
  AssistantCheckerVerdict,
  AssistantConfidence,
  AssistantContraindicationState,
  AssistantEvidenceItem,
  AssistantInvitation,
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
  emergency: "неотложная помощь",
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

export const agreementVerdictLabel: Record<AssistantAgreementVerdict, string> = {
  agree: "сходятся",
  differ: "расходятся",
};

/** Who is speaking in the conversation: the therapist («ИИ-врач») or one persona. */
export function speakerLabel(specialty: AssistantSpecialty | null): string {
  if (specialty === null) return "ИИ-врач";
  const label = specialtyLabel[specialty];
  return `ИИ-${label}`;
}

/** The printed names of the observations that put a specialist on the panel, each once. */
export function invitationNames(
  invitation: AssistantInvitation,
  evidence: ReadonlyMap<string, AssistantEvidenceItem>,
): string[] {
  return [
    ...new Set(
      invitation.observationIds
        .map((observationId) => evidence.get(observationId)?.name)
        .filter((name): name is string => name !== undefined),
    ),
  ];
}

/** Why a specialist is on the panel: every name — for the opinion's own heading. */
export function invitationCopy(
  invitation: AssistantInvitation,
  evidence: ReadonlyMap<string, AssistantEvidenceItem>,
): string {
  const names = invitationNames(invitation, evidence);
  return names.length === 0 ? "по вашему запросу" : `в данных: ${names.join(", ")}`;
}

/** The same reason in one line: three names and a count, so a specialist with forty stays a chip. */
export function invitationSummary(
  invitation: AssistantInvitation,
  evidence: ReadonlyMap<string, AssistantEvidenceItem>,
  shown = 3,
): string {
  const names = invitationNames(invitation, evidence);
  if (names.length === 0) return "по вашему запросу";
  const rest = names.length - shown;
  return `в данных: ${names.slice(0, shown).join(", ")}${rest > 0 ? ` и ещё ${rest}` : ""}`;
}

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

export function assistantConsiliumErrorCopy(error: unknown): string {
  if (error instanceof ApiError && error.code === "NOBODY_TO_CONVENE") {
    return "Некого приглашать: среди подтверждённых значений нет профильных показателей.";
  }
  return assistantSendErrorCopy(error);
}

export function assistantCreateErrorCopy(error: unknown): string {
  return error instanceof ApiError && error.status === 409
    ? "Нельзя создать больше 20 диалогов для одного профиля."
    : "Не удалось создать диалог. Проверьте соединение и повторите.";
}
