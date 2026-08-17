import { ANALYTE_AREAS, type AnalyteArea, type AssistantSpecialty } from "@veylta/contracts";
import { specialtyLabel } from "./assistant";
import type { DossierSeries } from "./dossier";
import { countCopy } from "./russian-plural";

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

export interface StatusCounts {
  readonly total: number;
  readonly outside: number;
  readonly within: number;
  readonly unknown: number;
}

export interface AreaSummary extends StatusCounts {
  readonly area: AnalyteArea;
  readonly label: string;
  /** Who reads this area's indicators, in first-seen order; `null` stands for the therapist. */
  readonly readers: readonly (AssistantSpecialty | null)[];
}

const isOutside = (series: DossierSeries): boolean =>
  series.status === "above" || series.status === "below" || series.status === "flagged";

/** How many indicators stand outside, inside, or without a printed reference. */
export function statusCounts(series: readonly DossierSeries[]): StatusCounts {
  const outside = series.filter(isOutside).length;
  const within = series.filter((item) => item.status === "within").length;
  return { total: series.length, outside, within, unknown: series.length - outside - within };
}

/** «12 показателей · 2 вне референса · 9 в референсе · 1 без референса» */
export function statusLine(counts: StatusCounts): string {
  if (counts.total === 0) return "Пока нет подтверждённых значений";
  const total = countCopy(counts.total, ["показатель", "показателя", "показателей"]);
  if (counts.outside === 0 && counts.unknown === 0) return `${total} · всё в референсе`;
  const parts = [total];
  if (counts.outside > 0) parts.push(`${counts.outside} вне референса`);
  if (counts.within > 0) parts.push(`${counts.within} в референсе`);
  if (counts.unknown > 0) parts.push(`${counts.unknown} без референса`);
  return parts.join(" · ");
}

/** «читает кардиолог», «читают гематолог, кардиолог», «читает терапевт». */
export function readersCopy(readers: readonly (AssistantSpecialty | null)[]): string {
  const names = readers.map((reader) => (reader === null ? "терапевт" : specialtyLabel[reader]));
  if (names.length === 0) return "читает терапевт";
  return `${names.length === 1 ? "читает" : "читают"} ${names.join(", ")}`;
}

/** Every area with confirmed data, in the record's fixed order, with its counts and readers. */
export function areaSummaries(series: readonly DossierSeries[]): AreaSummary[] {
  return ANALYTE_AREAS.flatMap((area) => {
    const own = series.filter((item) => item.area === area);
    if (own.length === 0) return [];
    const readers = [...new Set(own.map((item) => item.specialty))];
    return [{ area, label: dossierAreaLabel[area], readers, ...statusCounts(own) }];
  });
}
