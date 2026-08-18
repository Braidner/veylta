"use client";

import type {
  AssistantEvidenceRecordItem,
  AssistantOutcome,
  AssistantOutcomeRequest,
  AssistantOutcomeVerdict,
} from "@veylta/contracts";
import { ASSISTANT_OUTCOME_VERDICTS } from "@veylta/contracts";
import { Stethoscope } from "lucide-react";
import { useId, useState } from "react";
import { outcomeLine, outcomeVerdictCopy } from "../assistant-outcomes";
import { clinicianRecordKindLabel } from "../clinician-records";
import { formatSampleMoment } from "../format-moment";

/**
 * «Что сказал врач?» under a block the answer asks to confirm: the current mark as one line, and
 * a small form — verdict, the day the clinician said so, a note, the confirmed record that
 * documents it — that appends a new mark. The person's record of the visit, never a grade.
 */
export function AssistantOutcomeControl({
  outcome,
  records,
  canWrite,
  pending,
  onRecord,
}: {
  readonly outcome: AssistantOutcome | null;
  readonly records: ReadonlyMap<string, AssistantEvidenceRecordItem>;
  readonly canWrite: boolean;
  readonly pending: boolean;
  readonly onRecord: (request: AssistantOutcomeRequest) => Promise<boolean>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<AssistantOutcomeVerdict | null>(outcome?.verdict ?? null);
  const [decidedOn, setDecidedOn] = useState(outcome?.decidedOn ?? "");
  const [note, setNote] = useState(outcome?.note ?? "");
  const [recordId, setRecordId] = useState(outcome?.recordId ?? "");

  async function save(): Promise<void> {
    if (verdict === null) return;
    const saved = await onRecord({
      verdict,
      decidedOn: decidedOn === "" ? null : decidedOn,
      note: note.trim() === "" ? null : note.trim(),
      recordId: recordId === "" ? null : recordId,
    });
    if (saved) setOpen(false);
  }

  return (
    <div className="assistant-outcome" data-testid="assistant-outcome">
      {outcome !== null ? (
        <p className={`assistant-outcome__line is-${outcomeVerdictCopy[outcome.verdict].tone}`}>
          <Stethoscope size={13} aria-hidden="true" />
          {outcomeLine(outcome, records)}
        </p>
      ) : null}
      {canWrite && !open ? (
        <button type="button" className="text-button" onClick={() => setOpen(true)}>
          {outcome === null ? "Что сказал врач?" : "Изменить слово врача"}
        </button>
      ) : null}
      {canWrite && open ? (
        <form
          className="assistant-outcome__form"
          aria-label="Что сказал врач"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset className="assistant-outcome__verdicts">
            <legend>Вердикт врача</legend>
            {ASSISTANT_OUTCOME_VERDICTS.map((option) => (
              <button
                key={option}
                type="button"
                className={`assistant-chip${verdict === option ? " is-active" : ""}`}
                aria-pressed={verdict === option}
                onClick={() => setVerdict(option)}
              >
                {outcomeVerdictCopy[option].label}
              </button>
            ))}
          </fieldset>
          <label htmlFor={`${id}-date`}>
            Когда сказал
            <input
              id={`${id}-date`}
              type="date"
              value={decidedOn}
              onChange={(event) => setDecidedOn(event.target.value)}
            />
          </label>
          <label htmlFor={`${id}-record`}>
            Запись врача
            <select
              id={`${id}-record`}
              value={recordId}
              onChange={(event) => setRecordId(event.target.value)}
            >
              <option value="">без записи</option>
              {[...records.values()].map((record) => (
                <option key={record.recordId} value={record.recordId}>
                  {clinicianRecordKindLabel[record.kind as keyof typeof clinicianRecordKindLabel] ??
                    record.kind}{" "}
                  · {record.label}
                  {record.documentDate === null
                    ? ""
                    : ` · ${formatSampleMoment(record.documentDate)}`}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={`${id}-note`}>
            Заметка
            <input
              id={`${id}-note`}
              type="text"
              maxLength={500}
              placeholder="Своими словами — необязательно"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="assistant-outcome__actions">
            <button
              type="submit"
              className="button button--secondary"
              disabled={verdict === null || pending}
            >
              {pending ? "Сохраняем…" : "Сохранить"}
            </button>
            <button type="button" className="text-button" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
