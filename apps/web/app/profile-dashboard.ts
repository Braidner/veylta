import type { AssistantId, ProfileOverviewResponse } from "@veylta/contracts";
import { assistantStateLine } from "./dashboard-assistants";
import { formatSampleMoment } from "./format-moment";
import { assistantPath, documentPath, profileTabPath } from "./paths";
import { countCopy } from "./russian-plural";

export type DashboardAssistantId = "physician" | "nutrition" | "movement";
export type DashboardSignalTone = "neutral" | "positive" | "attention";

export interface DashboardAssistant {
  readonly id: DashboardAssistantId;
  readonly label: string;
  readonly role: string;
  readonly message: string;
  /** A standing constraint of the room; null when the block's own header already says it. */
  readonly meta: string | null;
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
    readonly outside: DashboardSignal;
    readonly documents: DashboardSignal;
    readonly confirmed: DashboardSignal;
  };
}

export type DashboardSignalKey = keyof ProfileDashboardModel["signals"];

/**
 * «Вне референса» is Veylta's own deterministic reading, and the dossier is where those
 * indicators are read with their specialty — so above zero the tile leads there. At zero there is
 * nothing to open, and the tile stays plain text.
 */
export function signalHref(
  key: DashboardSignalKey,
  overview: ProfileOverviewResponse,
): string | null {
  return key === "outside" && overview.outsideIndicatorCount > 0
    ? profileTabPath(overview.profile.handle, "dossier")
    : null;
}

/**
 * The physician card is the primary one. It reads only confirmed values, so while values still
 * wait for review it points there first; the second opinion opens once there is evidence. The
 * message here is what the card says before the room has ever answered — once it has, the room's
 * own state replaces it.
 */
function physician(overview: ProfileOverviewResponse): DashboardAssistant {
  const label = "ИИ-врач · второе мнение";
  const role = "Второе мнение по подтверждённым данным";
  const { handle } = overview.profile;
  const firstReview = overview.reviewQueue.documents[0];
  const activeDocument = overview.recentDocuments.find(
    (document) => !["completed", "failed", "awaiting_review"].includes(document.processing.state),
  );

  const pending = overview.reviewQueue.pendingFactCount;
  // The whole record decides, not the three values the response carries.
  if (overview.confirmedCount > 0) {
    return {
      id: "physician",
      label,
      role,
      message:
        pending > 0
          ? `${countCopy(pending, ["значение ещё ждёт", "значения ещё ждут", "значений ещё ждут"])} вашей проверки — ИИ-врач читает только подтверждённые. Разберу их с учётом вашего профиля и назову, что подтвердить у врача.`
          : "Разберу подтверждённые значения с учётом вашего профиля, назову вероятные объяснения и то, что стоит подтвердить у врача.",
      // The block header already carries «Не заменяют специалиста» — saying it twice is noise.
      meta: null,
      action: {
        label: "Открыть второе мнение",
        href: assistantPath(handle, "physician"),
      },
    };
  }

  if (pending > 0) {
    return {
      id: "physician",
      label,
      role,
      message: `${countCopy(pending, ["значение ждёт", "значения ждут", "значений ждут"])} вашей проверки. ИИ-врач читает только подтверждённые значения — сначала проверьте их.`,
      meta:
        overview.reviewQueue.needsAttentionFactCount > 0
          ? `${countCopy(overview.reviewQueue.needsAttentionFactCount, ["значение требует", "значения требуют", "значений требуют"])} особого внимания`
          : "Автоматических подтверждений нет",
      action: {
        label: "Проверить значения",
        href:
          firstReview === undefined
            ? `${profileTabPath(handle, "documents")}#overview-review-title`
            : documentPath(handle, firstReview.id),
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
        href: documentPath(handle, activeDocument.id),
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

/** A card says what its room last said; what the room is for is the line before it ever has. */
function withRoomState(
  card: DashboardAssistant,
  overview: ProfileOverviewResponse,
  assistantId: AssistantId,
  now: Date,
): DashboardAssistant {
  return {
    ...card,
    message: assistantStateLine(overview.assistants, assistantId, card.message, now),
  };
}

export function buildProfileDashboardModel(
  overview: ProfileOverviewResponse,
  now = new Date(),
): ProfileDashboardModel {
  const { confirmedCount, documentCount, outsideIndicatorCount } = overview;
  const newestDocument = overview.recentDocuments[0];
  const room = (card: DashboardAssistant, assistantId: AssistantId) =>
    withRoomState(card, overview, assistantId, now);

  return {
    assistants: [
      room(physician(overview), "physician"),
      room(
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
            href: assistantPath(overview.profile.handle, "nutritionist"),
          },
        },
        "nutritionist",
      ),
      room(
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
            href: assistantPath(overview.profile.handle, "trainer"),
          },
        },
        "trainer",
      ),
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
      outside: {
        label: "Вне референса",
        value: String(outsideIndicatorCount),
        detail:
          outsideIndicatorCount === 0
            ? "Все показатели в пределах диапазонов источников"
            : "Показатели, чьё последнее значение вне печатного диапазона",
        tone: outsideIndicatorCount === 0 ? "positive" : "attention",
      },
      documents: {
        label: "Документов",
        value: String(documentCount),
        detail:
          documentCount === 0 || newestDocument === undefined
            ? "Архив пока пуст"
            : `Последний — ${formatSampleMoment(newestDocument.effectiveDate.value)}`,
        tone: documentCount === 0 ? "neutral" : "positive",
      },
      confirmed: {
        label: "Подтверждено",
        value: String(confirmedCount),
        detail:
          confirmedCount === 0
            ? "Нет подтверждённых значений"
            : `${countCopy(confirmedCount, ["значение связано", "значения связаны", "значений связаны"])} с источником`,
        tone: confirmedCount === 0 ? "neutral" : "positive",
      },
    },
  };
}
