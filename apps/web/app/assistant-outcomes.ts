import {
  ASSISTANT_OUTCOME_BLOCK_KINDS,
  type AssistantBlock,
  type AssistantClinicianCheckClaim,
  type AssistantEvidenceRecordItem,
  type AssistantOutcome,
  type AssistantOutcomeSummary,
  type AssistantOutcomeVerdict,
} from "@veylta/contracts";
import { formatSampleMoment } from "./format-moment";

/** The clinician's word as a chip and as a sentence — the person's own record, never a grade. */
export const outcomeVerdictCopy: Record<
  AssistantOutcomeVerdict,
  { readonly label: string; readonly said: string; readonly tone: "calm" | "watch" | "muted" }
> = {
  confirmed: { label: "Подтвердил", said: "Врач подтвердил", tone: "calm" },
  modified: { label: "Изменил", said: "Врач изменил", tone: "watch" },
  rejected: { label: "Отклонил", said: "Врач отклонил", tone: "muted" },
};

/** Whether the person can record the clinician's word on this block. */
export function takesOutcome(block: AssistantBlock): boolean {
  return (ASSISTANT_OUTCOME_BLOCK_KINDS as readonly string[]).includes(block.kind);
}

/** «Врач изменил · 10.08.2026 · заметка · запись: Синтетический гипотиреоз» — one line. */
export function outcomeLine(
  outcome: AssistantOutcome,
  records: ReadonlyMap<string, AssistantEvidenceRecordItem>,
): string {
  const record = outcome.recordId === null ? undefined : records.get(outcome.recordId);
  return [
    outcomeVerdictCopy[outcome.verdict].said,
    ...(outcome.decidedOn === null ? [] : [formatSampleMoment(outcome.decidedOn)]),
    ...(outcome.note === null ? [] : [outcome.note]),
    ...(outcome.recordId === null
      ? []
      : [`запись врача: ${record === undefined ? "больше не подтверждена" : record.label}`]),
  ].join(" · ");
}

/** «подтверждено 1 · изменено 2 · отклонено 0». */
export function outcomeCountsCopy(counts: AssistantOutcomeSummary["counts"]): string {
  return `подтверждено ${counts.confirmed} · изменено ${counts.modified} · отклонено ${counts.rejected}`;
}

/** «сверка: согласен 1 · расходится 2 · не оценить 0» — the assistant's positions, counted. */
export function checkCountsCopy(
  checks: Readonly<Record<AssistantClinicianCheckClaim, number>>,
): string {
  return `сверка: согласен ${checks.agree} · расходится ${checks.differs} · не оценить ${checks.cannot_assess}`;
}

/** Nothing marked and nothing checked yet — the log has nothing to count. */
export function outcomesEmpty(summary: AssistantOutcomeSummary): boolean {
  return (
    summary.entries.length === 0 &&
    summary.checks.agree + summary.checks.differs + summary.checks.cannot_assess === 0
  );
}
