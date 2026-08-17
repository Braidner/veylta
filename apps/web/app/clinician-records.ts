import type { ClinicianRecordItem, ClinicianRecordKind } from "@veylta/contracts";
import { countCopy } from "./russian-plural";

/** How the record's kind reads on the page — the clinician's verb, not the model's type name. */
export const clinicianRecordKindLabel: Record<ClinicianRecordKind, string> = {
  diagnosis: "Диагноз",
  medication: "Назначение",
  procedure: "Процедура",
  referral: "Направление",
  follow_up: "Контроль",
  finding: "Наблюдение",
};

export interface RecordCounts {
  readonly confirmed: number;
  readonly rejected: number;
  readonly pending: number;
}

export function recordCounts(items: readonly ClinicianRecordItem[]): RecordCounts {
  const confirmed = items.filter((item) => item.record?.decision === "confirmed").length;
  const rejected = items.filter((item) => item.record?.decision === "rejected").length;
  return { confirmed, rejected, pending: items.length - confirmed - rejected };
}

/** «2 подтверждены · 1 отклонена · 2 ждут решения» — only the parts that are there. */
export function recordCountsLine(counts: RecordCounts): string {
  const parts: string[] = [];
  if (counts.confirmed > 0) {
    parts.push(`${counts.confirmed} ${counts.confirmed === 1 ? "подтверждена" : "подтверждены"}`);
  }
  if (counts.rejected > 0) {
    parts.push(`${counts.rejected} ${counts.rejected === 1 ? "отклонена" : "отклонены"}`);
  }
  if (counts.pending > 0) {
    parts.push(counts.pending === 1 ? "1 ждёт решения" : `${counts.pending} ждут решения`);
  }
  return parts.length === 0 ? "записей нет" : parts.join(" · ");
}

/** The wording the person stands behind — their correction when they gave one. */
export function recordText(item: ClinicianRecordItem): { label: string; detail: string | null } {
  return item.record === null
    ? item.extracted
    : { label: item.record.label, detail: item.record.detail };
}

/** «Диагноз: Синтетический гипотиреоз (E03.9); Назначение: …» — for a question to the assistant. */
export function confirmedRecordsCopy(items: readonly ClinicianRecordItem[]): string {
  return items
    .filter((item) => item.record?.decision === "confirmed")
    .map((item) => {
      const text = recordText(item);
      const detail = text.detail === null ? "" : ` (${text.detail})`;
      return `${clinicianRecordKindLabel[item.kind]}: ${text.label}${detail}`;
    })
    .join("; ");
}

export const recordsCountCopy = (count: number) =>
  countCopy(count, ["запись врача", "записи врача", "записей врача"]);

/** The question the document page hands to the therapist: the confirmed records, and what to do. */
export function checkQuestion(
  items: readonly ClinicianRecordItem[],
  documentDate: string | null,
): string {
  const when = documentDate === null ? "" : ` от ${documentDate.split("-").reverse().join(".")}`;
  return `Сверь записи врача из документа${when} с моим досье и подтверждёнными значениями: ${confirmedRecordsCopy(items)}. Где вы согласны, где расходитесь и почему, и что спросить на визите?`;
}
