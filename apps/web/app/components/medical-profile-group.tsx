"use client";

import type { MedicalProfileEntry, MedicalProfileEntryKind } from "@veylta/contracts";
import type { FormEvent } from "react";
import { formatSampleMoment } from "../format-moment";
import {
  type MedicalProfileGroup as GroupModel,
  medicalProfileInput,
  medicalProfileKindLabels,
  medicalProfileValueCopy,
} from "../medical-profile";
import { type Draft, ValueControl } from "./medical-profile-controls";

export function MedicalProfileGroup({
  group,
  entries,
  addableKinds,
  canWrite,
  pending,
  draft,
  formId,
  onStart,
  onDraftChange,
  onSubmit,
  onArchive,
}: {
  group: GroupModel;
  entries: readonly MedicalProfileEntry[];
  addableKinds: readonly MedicalProfileEntryKind[];
  canWrite: boolean;
  pending: boolean;
  draft: Draft | null;
  formId: string;
  onStart: () => void;
  onDraftChange: (draft: Draft | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onArchive: (entry: MedicalProfileEntry) => void;
}) {
  const open = draft !== null;
  return (
    <section className="medical-profile__group" aria-label={group.title}>
      <div className="medical-profile__group-heading">
        <h4>{group.title}</h4>
        {canWrite && addableKinds.length > 0 && !open ? (
          <button className="text-link text-link--button" type="button" onClick={onStart}>
            Добавить
          </button>
        ) : null}
      </div>
      {entries.length === 0 && !open ? (
        <p className="medical-profile__empty">Пока не указано.</p>
      ) : (
        <ul className="medical-profile__entries">
          {entries.map((entry) => (
            <li key={entry.id} className="medical-profile__entry">
              <span className="medical-profile__entry-kind">
                {medicalProfileKindLabels[entry.kind]}
              </span>
              <span className="medical-profile__entry-value">
                {medicalProfileValueCopy(entry)}
                {entry.recordedOn === null ? null : (
                  <time dateTime={entry.recordedOn}>
                    {" · "}
                    {formatSampleMoment(entry.recordedOn)}
                  </time>
                )}
              </span>
              {canWrite ? (
                <button
                  className="text-link text-link--button medical-profile__remove"
                  type="button"
                  disabled={pending}
                  onClick={() => onArchive(entry)}
                >
                  Убрать
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {open && draft !== null ? (
        <form className="medical-profile__form" onSubmit={onSubmit}>
          <label className="field">
            <span>Что записать</span>
            <select
              value={draft.kind}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  kind: event.target.value as MedicalProfileEntryKind,
                  value: "",
                })
              }
            >
              {addableKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {medicalProfileKindLabels[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor={`${formId}-value`}>
            <span>Значение</span>
            <ValueControl
              id={`${formId}-value`}
              kind={draft.kind}
              value={draft.value}
              onChange={(value) => onDraftChange({ ...draft, value })}
            />
          </label>
          {medicalProfileInput(draft.kind).control === "text" &&
          (medicalProfileInput(draft.kind) as { dated?: boolean }).dated ? (
            <label className="field">
              <span>Дата (необязательно)</span>
              <input
                type="date"
                value={draft.recordedOn}
                onChange={(event) => onDraftChange({ ...draft, recordedOn: event.target.value })}
              />
            </label>
          ) : null}
          <div className="medical-profile__form-actions">
            <button className="button button--primary" type="submit" disabled={pending}>
              {pending ? "Сохраняем…" : "Сохранить"}
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => onDraftChange(null)}
              disabled={pending}
            >
              Отмена
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
