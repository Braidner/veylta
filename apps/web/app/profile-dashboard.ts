import type { ProfileOverviewResponse } from "@veylta/contracts";

export type DashboardAssistantId = "medical_navigator" | "nutrition" | "movement";
export type DashboardSignalTone = "neutral" | "positive" | "attention";

export interface DashboardAssistant {
  readonly id: DashboardAssistantId;
  readonly label: string;
  readonly role: string;
  readonly message: string;
  readonly meta: string;
  readonly action: {
    readonly label: string;
    readonly href: string;
  };
}

export interface DashboardSignal {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly tone: DashboardSignalTone;
}

export interface ProfileDashboardModel {
  readonly assistants: readonly [DashboardAssistant, DashboardAssistant, DashboardAssistant];
  readonly signals: {
    readonly pendingReview: DashboardSignal;
    readonly sourceFlags: DashboardSignal;
    readonly sources: DashboardSignal;
    readonly confirmed: DashboardSignal;
  };
}

function profilePath(familyId: string, profileId: string): string {
  return `/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}`;
}

function documentPath(familyId: string, profileId: string, documentId: string): string {
  return `${profilePath(familyId, profileId)}/documents/${encodeURIComponent(documentId)}`;
}

function countCopy(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word =
    mod100 >= 11 && mod100 <= 14 ? many : mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many;
  return `${count} ${word}`;
}

function medicalNavigator(overview: ProfileOverviewResponse): DashboardAssistant {
  const firstReview = overview.reviewQueue.documents[0];
  if (overview.reviewQueue.pendingFactCount > 0) {
    return {
      id: "medical_navigator",
      label: "Медицинский навигатор",
      role: "Навигация по вашим источникам",
      message: `${countCopy(overview.reviewQueue.pendingFactCount, "значение ждёт", "значения ждут", "значений ждут")} вашей проверки. Я покажу исходный фрагмент перед каждым решением.`,
      meta:
        overview.reviewQueue.needsAttentionFactCount > 0
          ? `${countCopy(overview.reviewQueue.needsAttentionFactCount, "значение требует", "значения требуют", "значений требуют")} особого внимания`
          : "Автоматических подтверждений нет",
      action: {
        label: "Проверить значения",
        href:
          firstReview === undefined
            ? "#overview-review-title"
            : documentPath(overview.profile.familyId, overview.profile.id, firstReview.id),
      },
    };
  }

  const activeDocument = overview.recentDocuments.find(
    (document) => !["completed", "failed", "awaiting_review"].includes(document.processing.state),
  );
  if (activeDocument !== undefined) {
    return {
      id: "medical_navigator",
      label: "Медицинский навигатор",
      role: "Навигация по вашим источникам",
      message:
        "Новый источник обрабатывается локально. Я сообщу, когда появятся значения для проверки.",
      meta: "Документ ещё не стал подтверждённой записью",
      action: {
        label: "Открыть обработку",
        href: documentPath(overview.profile.familyId, overview.profile.id, activeDocument.id),
      },
    };
  }

  if (overview.recentObservations.length > 0) {
    return {
      id: "medical_navigator",
      label: "Медицинский навигатор",
      role: "Навигация по вашим источникам",
      message:
        "Новых решений нет. Последние подтверждённые значения сохранены вместе с документом, страницей и фрагментом.",
      meta: "Без диагноза и скрытых выводов",
      action: { label: "Открыть историю", href: "#observation-history" },
    };
  }

  return {
    id: "medical_navigator",
    label: "Медицинский навигатор",
    role: "Навигация по вашим источникам",
    message:
      "Добавьте первый источник. Я помогу разобрать его на проверяемые значения, но ничего не подтвержу за вас.",
    meta: "Поддерживаются только синтетические документы",
    action: { label: "Добавить источник", href: "#document-inbox-title" },
  };
}

export function buildProfileDashboardModel(
  overview: ProfileOverviewResponse,
): ProfileDashboardModel {
  const explicitSourceFlags = overview.recentObservations.filter(
    (observation) => observation.referenceRange?.laboratoryOutOfRange === true,
  ).length;
  const sourceCount = overview.recentDocuments.length;
  const confirmedCount = overview.recentObservations.length;

  return {
    assistants: [
      medicalNavigator(overview),
      {
        id: "nutrition",
        label: "Питание",
        role: "Codex · только по вашему запросу",
        message:
          confirmedCount === 0
            ? "Пока недостаточно данных для безопасного предложения. Сначала нужны подтверждённые источники и ваши ограничения."
            : "Могу подготовить черновик для плана заботы только из подтверждённых значений и после вашего решения.",
        meta: "Не назначает рацион и добавки",
        action: { label: "Открыть план", href: "#care-plan" },
      },
      {
        id: "movement",
        label: "Движение",
        role: "Codex · только по вашему запросу",
        message:
          confirmedCount === 0
            ? "Чтобы предложить безопасный следующий шаг, сначала укажите ограничения и подтвердите исходные данные."
            : "Могу собрать бережный черновик активности из вашего контекста. Он попадёт в план только после подтверждения.",
        meta: "Не заменяет тренера или врача",
        action: { label: "Открыть план", href: "#care-plan" },
      },
    ],
    signals: {
      pendingReview: {
        label: "Ждёт проверки",
        value: String(overview.reviewQueue.pendingFactCount),
        detail:
          overview.reviewQueue.pendingFactCount === 0
            ? "Все извлечённые значения разобраны"
            : "Только вы можете подтвердить значение",
        tone: overview.reviewQueue.pendingFactCount === 0 ? "positive" : "attention",
      },
      sourceFlags: {
        label: "Отмечено источником",
        value: String(explicitSourceFlags),
        detail:
          explicitSourceFlags === 0
            ? "Нет явных отметок в последних данных"
            : `${countCopy(explicitSourceFlags, "значение вне", "значения вне", "значений вне")} диапазона источника`,
        tone: explicitSourceFlags === 0 ? "positive" : "attention",
      },
      sources: {
        label: "Последние источники",
        value: String(sourceCount),
        detail:
          sourceCount === 0
            ? "Архив пока пуст"
            : `В обзоре ${countCopy(sourceCount, "источник", "источника", "источников")}`,
        tone: sourceCount === 0 ? "neutral" : "positive",
      },
      confirmed: {
        label: "Подтверждено",
        value: String(confirmedCount),
        detail:
          confirmedCount === 0
            ? "Нет подтверждённых значений"
            : `${countCopy(confirmedCount, "значение связано", "значения связаны", "значений связаны")} с источником`,
        tone: confirmedCount === 0 ? "neutral" : "positive",
      },
    },
  };
}
