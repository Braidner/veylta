import type { ProfileOverviewResponse } from "@veylta/contracts";
import { assistantPath, documentPath, profileTabPath } from "./paths";

export type DashboardAssistantId = "physician" | "nutrition" | "movement";
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

function countCopy(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word =
    mod100 >= 11 && mod100 <= 14 ? many : mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many;
  return `${count} ${word}`;
}

/**
 * The physician card is the primary one. It reads only confirmed values, so while values still
 * wait for review it points there first; the second opinion opens once there is evidence.
 */
function physician(overview: ProfileOverviewResponse): DashboardAssistant {
  const label = "ИИ-врач · второе мнение";
  const role = "Второе мнение по подтверждённым данным";
  const { familyId, id: profileId } = overview.profile;
  const firstReview = overview.reviewQueue.documents[0];
  const activeDocument = overview.recentDocuments.find(
    (document) => !["completed", "failed", "awaiting_review"].includes(document.processing.state),
  );

  const pending = overview.reviewQueue.pendingFactCount;
  if (overview.recentObservations.length > 0) {
    return {
      id: "physician",
      label,
      role,
      message:
        pending > 0
          ? `${countCopy(pending, "значение ещё ждёт", "значения ещё ждут", "значений ещё ждут")} вашей проверки — ИИ-врач читает только подтверждённые. Разберу их с учётом вашего профиля и назову, что подтвердить у врача.`
          : "Разберу подтверждённые значения с учётом вашего профиля, назову вероятные объяснения и то, что стоит подтвердить у врача.",
      meta: "Рекомендации для разговора с врачом, не диагноз",
      action: {
        label: "Открыть второе мнение",
        href: assistantPath(familyId, profileId, "physician"),
      },
    };
  }

  if (pending > 0) {
    return {
      id: "physician",
      label,
      role,
      message: `${countCopy(pending, "значение ждёт", "значения ждут", "значений ждут")} вашей проверки. ИИ-врач читает только подтверждённые значения — сначала проверьте их.`,
      meta:
        overview.reviewQueue.needsAttentionFactCount > 0
          ? `${countCopy(overview.reviewQueue.needsAttentionFactCount, "значение требует", "значения требуют", "значений требуют")} особого внимания`
          : "Автоматических подтверждений нет",
      action: {
        label: "Проверить значения",
        href:
          firstReview === undefined
            ? `${profileTabPath(familyId, profileId, "documents")}#overview-review-title`
            : documentPath(familyId, profileId, firstReview.id),
      },
    };
  }

  if (activeDocument !== undefined) {
    return {
      id: "physician",
      label,
      role,
      message:
        "Новый источник обрабатывается локально. Когда значения будут подтверждены, ИИ-врач сможет их разобрать.",
      meta: "Документ ещё не стал подтверждённой записью",
      action: {
        label: "Открыть обработку",
        href: documentPath(familyId, profileId, activeDocument.id),
      },
    };
  }

  return {
    id: "physician",
    label,
    role,
    message:
      "Добавьте первый источник и подтвердите значения — тогда появится второе мнение по ним.",
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
      physician(overview),
      {
        id: "nutrition",
        label: "ИИ-нутрициолог",
        role: "Питание по подтверждённым данным",
        message:
          confirmedCount === 0
            ? "Пока нечего оценивать: план питания строится на подтверждённых значениях и вашем профиле — лекарствах, диагнозах, ограничениях, целях."
            : "Оценю рацион по подтверждённым значениям и профилю: что усилить, что ограничить, что измерить снова — и что сверить с врачом.",
        meta: "Добавки — по названию, без доз; каждый пункт подтверждает диетолог или врач",
        action: {
          label: "Открыть питание",
          href: assistantPath(overview.profile.familyId, overview.profile.id, "nutritionist"),
        },
      },
      {
        id: "movement",
        label: "ИИ-тренер",
        role: "Нагрузка по подтверждённым данным",
        message:
          confirmedCount === 0
            ? "Пока нечего оценивать: программа строится на подтверждённых значениях, ваших ограничениях, допуске и отметках в плане."
            : "Оценю нагрузку по подтверждённым значениям, ограничениям и допуску: что делать, сколько, как прибавлять по вашим отметкам — и когда остановиться.",
        meta: "Не заменяет тренера или врача; каждый пункт подтверждает физиотерапевт или врач",
        action: {
          label: "Открыть активность",
          href: assistantPath(overview.profile.familyId, overview.profile.id, "trainer"),
        },
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
