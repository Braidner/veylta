"use client";

import type {
  CarePlanCheckin,
  CarePlanCheckinStatus,
  CarePlanItemResponse,
} from "@veylta/contracts";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { apiRequest } from "../api-client";
import {
  checkinCellTitle,
  checkinGrid,
  checkinSummaryCopy,
  localDateOf,
} from "../care-plan-checkins";

/**
 * The person's own diary on one regimen item: the last four weeks as a strip of days, and today's
 * mark — «сделал» or «пропустил» with an optional note in their words. The same day again
 * replaces the mark; the trainer reads these marks to build progression on what was done.
 */
export function CarePlanCheckins({
  itemPath,
  checkins,
  canWrite,
  onRecorded,
}: {
  /** The item's own API path; the mark goes to `…/checkins/:date`. */
  readonly itemPath: string;
  readonly checkins: readonly CarePlanCheckin[];
  readonly canWrite: boolean;
  readonly onRecorded: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<CarePlanCheckinStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = localDateOf(new Date());
  const cells = checkinGrid(checkins, today);
  const todayMark = checkins.find((mark) => mark.date === today) ?? null;

  async function mark(status: CarePlanCheckinStatus): Promise<void> {
    if (pending !== null) return;
    setPending(status);
    setError(null);
    try {
      await apiRequest<CarePlanItemResponse>(`${itemPath}/checkins/${today}`, {
        method: "PUT",
        body: JSON.stringify({ status, note: note.trim() === "" ? null : note.trim() }),
      });
      setNote("");
      await onRecorded();
    } catch {
      setError("Не удалось сохранить отметку. Повторите попытку.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="care-plan-checkins" data-testid="care-plan-checkins">
      <ol className="care-plan-checkins__grid" aria-label="Отметки за 4 недели">
        {cells.map((cell) => (
          <li
            key={cell.date}
            className={`care-plan-checkins__cell${cell.status === null ? "" : ` is-${cell.status}`}${cell.today ? " is-today" : ""}`}
            title={checkinCellTitle(cell)}
          >
            <span className="visually-hidden">{checkinCellTitle(cell)}</span>
          </li>
        ))}
      </ol>
      <p className="care-plan-checkins__summary">{checkinSummaryCopy(checkins)}</p>
      {canWrite ? (
        <div className="care-plan-checkins__today">
          <span>Сегодня:</span>
          <button
            type="button"
            className={`care-plan-checkins__mark${todayMark?.status === "done" ? " is-active" : ""}`}
            aria-pressed={todayMark?.status === "done"}
            disabled={pending !== null}
            onClick={() => void mark("done")}
          >
            <Check size={14} aria-hidden="true" />
            {pending === "done" ? "Сохраняем…" : "Сделал"}
          </button>
          <button
            type="button"
            className={`care-plan-checkins__mark${todayMark?.status === "skipped" ? " is-active" : ""}`}
            aria-pressed={todayMark?.status === "skipped"}
            disabled={pending !== null}
            onClick={() => void mark("skipped")}
          >
            <X size={14} aria-hidden="true" />
            {pending === "skipped" ? "Сохраняем…" : "Пропустил"}
          </button>
          <input
            type="text"
            className="care-plan-checkins__note"
            aria-label="Заметка к отметке"
            placeholder="Заметка — необязательно"
            maxLength={200}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={pending !== null}
          />
        </div>
      ) : null}
      {error !== null ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
