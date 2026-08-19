"use client";

import { type FormEvent, useId, useState } from "react";

/** The date field behind «Исправить дату»: a calendar day up to tomorrow, «Сбросить» returns the document's own date. */
export function DocumentDateEditor({
  value,
  max,
  canClear,
  pending,
  error,
  onSave,
  onClear,
  onCancel,
}: {
  readonly value: string;
  readonly max: string;
  readonly canClear: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSave: (value: string) => void;
  readonly onClear: () => void;
  readonly onCancel: () => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const invalid = draft.length !== 10 || draft > max;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invalid) onSave(draft);
  }
  return (
    <form
      className="document-date-editor"
      aria-label="Исправление даты документа"
      onSubmit={submit}
    >
      <label className="field" htmlFor={`${id}-date`}>
        <span>Дата документа</span>
        <input
          id={`${id}-date`}
          type="date"
          value={draft}
          max={max}
          disabled={pending}
          required
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <div className="document-date-editor__actions">
        <button className="button button--secondary" type="submit" disabled={pending || invalid}>
          {pending ? "Сохраняем…" : "Сохранить дату"}
        </button>
        {canClear ? (
          <button
            className="text-link text-link--button"
            type="button"
            disabled={pending}
            onClick={onClear}
          >
            Сбросить
          </button>
        ) : null}
        <button
          className="text-link text-link--button"
          type="button"
          disabled={pending}
          onClick={onCancel}
        >
          Отмена
        </button>
      </div>
      {error !== null ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
