import type { ObservationHistoryItem } from "@veylta/contracts";
import { apiPrefix } from "./api-client";

export interface ObservationDate {
  label: string;
  value: string;
}

export function timelineDate(item: ObservationHistoryItem): ObservationDate {
  if (item.dates.sampledAt !== null) {
    return { label: "Дата биоматериала", value: item.dates.sampledAt };
  }
  if (item.dates.resultedAt !== null) {
    return { label: "Дата результата", value: item.dates.resultedAt };
  }
  return { label: "Дата загрузки", value: item.dates.uploadedAt };
}

export function knownObservationDates(item: ObservationHistoryItem): readonly ObservationDate[] {
  return [
    item.dates.sampledAt === null
      ? null
      : { label: "Дата биоматериала", value: item.dates.sampledAt },
    item.dates.resultedAt === null
      ? null
      : { label: "Дата результата", value: item.dates.resultedAt },
    { label: "Дата загрузки", value: item.dates.uploadedAt },
  ].filter((date): date is ObservationDate => date !== null);
}

export function observationSourceHref(contentPath: string): string {
  return `${apiPrefix}${contentPath}`;
}
