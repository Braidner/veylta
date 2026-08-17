import {
  type AnalyteArea,
  type AssistantSpecialty,
  analyteArea,
  analyteSpecialty,
  type ObservationHistoryItem,
} from "@veylta/contracts";
import { specialtyLabel } from "./assistant";

/** How the dossier groups indicators; every code lands in exactly one area. */
export const dossierAreaLabel: Record<AnalyteArea, string> = {
  blood: "Кровь",
  iron: "Обмен железа",
  coagulation: "Свёртывание",
  lipids: "Липиды",
  liver: "Печень",
  pancreas: "Поджелудочная железа",
  kidney: "Почки",
  electrolytes: "Электролиты и минералы",
  glucose: "Углеводный обмен",
  thyroid: "Щитовидная железа",
  hormones: "Гормоны",
  inflammation: "Воспаление",
  protein: "Белки",
  vitamins: "Витамины",
  prostate: "Простата",
  other: "Другие показатели",
};

/** Where a value stands against the source's own reference; a comparison value has no number. */
export type PointStatus = "above" | "below" | "within" | "flagged" | "unknown";

export interface SeriesPoint {
  readonly observationId: string;
  readonly at: string;
  readonly printed: string;
  readonly value: number | null;
  readonly status: PointStatus;
  readonly rangeText: string | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly documentId: string;
}

export interface DossierSeries {
  readonly key: string;
  readonly code: string | null;
  readonly name: string;
  readonly unit: string;
  readonly area: AnalyteArea;
  readonly specialty: AssistantSpecialty | null;
  /** Oldest first, so a chart reads left to right. */
  readonly points: readonly SeriesPoint[];
  readonly latest: SeriesPoint;
  readonly previous: SeriesPoint | null;
  readonly delta: {
    readonly value: string;
    readonly direction: "increased" | "decreased" | "unchanged";
  } | null;
  readonly status: PointStatus;
  /** How many latest values in a row stand outside the range (0 when the latest is inside). */
  readonly streak: number;
}

const numberOf = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const decimalsOf = (printed: string): number => {
  const fraction = printed.trim().split(/[.,]/)[1];
  return fraction === undefined ? 0 : fraction.length;
};

function statusOf(item: ObservationHistoryItem, value: number | null): PointStatus {
  const range = item.referenceRange;
  if (range === null) return "unknown";
  const low = numberOf(range.sourceLow);
  const high = numberOf(range.sourceHigh);
  if (value !== null && (low !== null || high !== null)) {
    if (low !== null && value < low) return "below";
    if (high !== null && value > high) return "above";
    return "within";
  }
  if (range.laboratoryOutOfRange === true) return "flagged";
  if (range.laboratoryOutOfRange === false) return "within";
  return "unknown";
}

const outside = (status: PointStatus): boolean =>
  status === "above" || status === "below" || status === "flagged";

function pointOf(item: ObservationHistoryItem): SeriesPoint {
  const value = numberOf(item.source.value);
  return {
    observationId: item.id,
    at: item.timelineAt,
    printed: item.source.value,
    value,
    status: statusOf(item, value),
    rangeText: item.referenceRange?.sourceText ?? null,
    low: numberOf(item.referenceRange?.sourceLow),
    high: numberOf(item.referenceRange?.sourceHigh),
    documentId: item.sourceDocument.id,
  };
}

/** The change since the previous confirmed value, printed the way the latest value is. */
function deltaOf(latest: SeriesPoint, previous: SeriesPoint | null): DossierSeries["delta"] {
  if (previous === null || latest.value === null || previous.value === null) return null;
  const decimals = Math.max(decimalsOf(latest.printed), decimalsOf(previous.printed));
  const difference = Number((latest.value - previous.value).toFixed(decimals));
  const separator = latest.printed.includes(",") ? "," : ".";
  const magnitude = Math.abs(difference).toFixed(decimals).replace(".", separator);
  if (difference === 0) return { value: magnitude, direction: "unchanged" };
  return {
    value: `${difference > 0 ? "+" : "−"}${magnitude}`,
    direction: difference > 0 ? "increased" : "decreased",
  };
}

/**
 * One series per analyte and printed unit, oldest first, each point read against the source's
 * own reference. Nothing is converted or mixed: two units of one code are two series.
 */
export function buildDossierSeries(
  items: readonly ObservationHistoryItem[],
  sex: "female" | "male" | null,
): DossierSeries[] {
  const groups = new Map<string, ObservationHistoryItem[]>();
  for (const item of items) {
    const key = `${item.canonicalCode ?? item.source.name.toLocaleLowerCase("ru-RU")}|${item.source.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const ordered = [...group].sort((a, b) => a.timelineAt.localeCompare(b.timelineAt));
      const points = ordered.map(pointOf);
      const latest = points[points.length - 1] as SeriesPoint;
      const previous = points.length > 1 ? (points[points.length - 2] ?? null) : null;
      let streak = 0;
      for (
        let index = points.length - 1;
        index >= 0 && outside(points[index]?.status ?? "unknown");
        index -= 1
      ) {
        streak += 1;
      }
      const newest = ordered[ordered.length - 1] as ObservationHistoryItem;
      return {
        key,
        code: newest.canonicalCode,
        name: newest.source.name,
        unit: newest.source.unit,
        area: analyteArea(newest.canonicalCode),
        specialty: analyteSpecialty(newest.canonicalCode, sex),
        points,
        latest,
        previous,
        delta: deltaOf(latest, previous),
        status: latest.status,
        streak,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key, "ru-RU"));
}

export interface SeriesAssessmentCopy {
  readonly tone: "calm" | "watch";
  readonly headline: string;
  readonly detail: string;
  readonly nextStep: {
    readonly specialty: AssistantSpecialty | null;
    readonly copy: string;
  } | null;
}

const ordinal = ["", "", "второй", "третий", "четвёртый", "пятый"] as const;

/**
 * Veylta's own read of one series: where the latest value stands against the printed range,
 * how it moved, whether it repeats — and whom to show it to. A rule states facts and names the
 * doctor; the meaning of the finding is the assistant's and the clinician's to give.
 */
export function seriesAssessment(series: DossierSeries): SeriesAssessmentCopy {
  const range = series.latest.rangeText === null ? "" : ` (${series.latest.rangeText})`;
  const movement =
    series.delta === null
      ? series.points.length > 1
        ? "предыдущее значение не сравнимо"
        : "первое подтверждённое значение"
      : series.delta.direction === "unchanged"
        ? "без изменений с прошлого раза"
        : `с прошлого раза ${series.delta.value}`;
  const repeat =
    series.streak >= 2
      ? `, ${series.streak <= 5 ? ordinal[series.streak] : `${series.streak}-й`} раз подряд вне референса`
      : "";
  const detail = `${movement}${repeat}`;
  const headlines: Record<PointStatus, string> = {
    above: `Выше референса лаборатории${range}`,
    below: `Ниже референса лаборатории${range}`,
    flagged: "Лаборатория отметила значение вне референса",
    within: `В пределах референса${range}`,
    unknown: "Референс не напечатан — оценить нельзя",
  };
  if (!outside(series.status)) {
    return { tone: "calm", headline: headlines[series.status], detail, nextStep: null };
  }
  const who =
    series.specialty === null ? "терапевту" : `врачу — ${specialtyLabel[series.specialty]}`;
  return {
    tone: "watch",
    headline: headlines[series.status],
    detail,
    nextStep: {
      specialty: series.specialty,
      copy: `Стоит показать ${who}: значение подтверждено и вне референса. Насколько срочно — спросите ИИ-врача.`,
    },
  };
}

export interface AttentionGroup {
  readonly specialty: AssistantSpecialty | null;
  readonly series: readonly DossierSeries[];
}

/** Everything outside its range, grouped by the specialty that reads it; the therapist last. */
export function attentionBySpecialty(series: readonly DossierSeries[]): AttentionGroup[] {
  const groups = new Map<AssistantSpecialty | null, DossierSeries[]>();
  for (const item of series) {
    if (!outside(item.status)) continue;
    groups.set(item.specialty, [...(groups.get(item.specialty) ?? []), item]);
  }
  return [...groups.entries()]
    .map(([specialty, list]) => ({ specialty, series: list }))
    .sort((a, b) => {
      if (a.specialty === null) return 1;
      if (b.specialty === null) return -1;
      return b.series.length - a.series.length || a.specialty.localeCompare(b.specialty);
    });
}
