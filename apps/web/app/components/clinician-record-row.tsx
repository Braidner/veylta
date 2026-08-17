"use client";

import type { ClinicianRecordItem } from "@veylta/contracts";
import { Check, ExternalLink, Pencil, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { clinicianRecordKindLabel, recordText } from "../clinician-records";
import { formatShortMoment } from "../format-moment";

export type RecordDecision = (
  resultKey: string,
  decision: "confirm" | "reject",
  correction?: { label: string; detail: string | null },
) => Promise<void>;

/** One statement: its kind, the wording, its page and fragment, and the decision or the actions. */
export function RecordRow({
  item,
  contentUrl,
  canWrite,
  pending,
  onDecide,
}: {
  readonly item: ClinicianRecordItem;
  readonly contentUrl: string;
  readonly canWrite: boolean;
  readonly pending: boolean;
  readonly onDecide: RecordDecision;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(item.extracted.label);
  const [detail, setDetail] = useState(item.extracted.detail ?? "");
  const text = recordText(item);
  const corrected =
    item.record !== null &&
    (item.record.label !== item.extracted.label || item.record.detail !== item.extracted.detail);

  async function submitCorrection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (label.trim().length === 0) return;
    await onDecide(item.resultKey, "confirm", {
      label: label.trim(),
      detail: detail.trim().length === 0 ? null : detail.trim(),
    });
    setEditing(false);
  }

  return (
    <li
      className={`clinician-record${item.record === null ? " is-pending" : ` is-${item.record.decision}`}`}
      data-testid="clinician-record"
      data-kind={item.kind}
    >
      <span className="clinician-record__kind">{clinicianRecordKindLabel[item.kind]}</span>
      <div className="clinician-record__body">
        {editing ? (
          <form className="clinician-record__form" onSubmit={submitCorrection}>
            <label>
              <span>Формулировка</span>
              <input value={label} maxLength={500} onChange={(e) => setLabel(e.target.value)} />
            </label>
            <label>
              <span>Уточнение (доза, срок, кому)</span>
              <input value={detail} maxLength={500} onChange={(e) => setDetail(e.target.value)} />
            </label>
            <div className="clinician-record__actions">
              <button className="button button--primary" type="submit" disabled={pending}>
                Подтвердить в этой формулировке
              </button>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => setEditing(false)}
              >
                Отмена
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="clinician-record__text">
              <strong>{text.label}</strong>
              {text.detail === null ? null : <span> · {text.detail}</span>}
            </p>
            {corrected ? (
              <p className="clinician-record__extracted">
                В документе: {item.extracted.label}
                {item.extracted.detail === null ? "" : ` · ${item.extracted.detail}`}
              </p>
            ) : null}
            <a
              className="clinician-record__source"
              href={`${contentUrl}#page=${item.source.pageNumber}`}
              target="_blank"
              rel="noreferrer"
            >
              стр. {item.source.pageNumber} · «{item.source.fragment}»
              <ExternalLink size={12} aria-hidden="true" />
            </a>
            {item.record !== null ? (
              <p className={`clinician-record__decision is-${item.record.decision}`}>
                {item.record.decision === "confirmed" ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <X size={14} aria-hidden="true" />
                )}
                {item.record.decision === "confirmed" ? "Подтверждено" : "Отклонено"}{" "}
                <time dateTime={item.record.decidedAt}>
                  {formatShortMoment(item.record.decidedAt)}
                </time>
              </p>
            ) : canWrite ? (
              <div className="clinician-record__actions">
                <button
                  className="button button--primary"
                  type="button"
                  disabled={pending}
                  onClick={() => void onDecide(item.resultKey, "confirm")}
                >
                  <Check size={14} aria-hidden="true" />
                  Подтвердить
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={pending}
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} aria-hidden="true" />
                  Уточнить формулировку
                </button>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={pending}
                  onClick={() => void onDecide(item.resultKey, "reject")}
                >
                  <X size={14} aria-hidden="true" />
                  Отклонить
                </button>
              </div>
            ) : (
              <p className="clinician-record__decision">Ждёт решения владельца профиля</p>
            )}
          </>
        )}
      </div>
    </li>
  );
}
