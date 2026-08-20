"use client";

import type { CarePlanCheckinStatus } from "@veylta/contracts";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { checkinCellTitle } from "../care-plan-checkins";
import { carePlanItemPath, recordCheckin } from "../care-plan-mark";
import type { DashboardTodayRow } from "../dashboard-plan";

function cellClassName(status: CarePlanCheckinStatus | null, today: boolean): string {
  return `care-plan-checkins__cell${status === null ? "" : ` is-${status}`}${today ? " is-today" : ""}`;
}

/**
 * One accepted regimen item as the overview offers it: the week's rhythm, today's mark in words and
 * the two buttons that set it. A note stays the plan page's job — here the day is one press.
 */
function TodayItem({
  row,
  itemPath,
  today,
  canWrite,
  onRecorded,
}: {
  readonly row: DashboardTodayRow;
  readonly itemPath: string;
  readonly today: string;
  readonly canWrite: boolean;
  readonly onRecorded: () => Promise<void>;
}) {
  const [pending, setPending] = useState<CarePlanCheckinStatus | null>(null);
  const [failed, setFailed] = useState(false);

  async function mark(status: CarePlanCheckinStatus): Promise<void> {
    if (pending !== null) return;
    setPending(status);
    setFailed(false);
    try {
      await recordCheckin(itemPath, today, { status, note: null });
      await onRecorded();
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  return (
    <li className="dashboard-today__item">
      <p className="dashboard-today__head">
        <span className="dashboard-plan__lane">{row.lane}</span>
        <strong>{row.title}</strong>
      </p>
      <div className="dashboard-today__rhythm">
        <ol className="dashboard-today__week" aria-label={`Ритм за неделю: ${row.title}`}>
          {row.week.map((cell) => (
            <li key={cell.date} className={cellClassName(cell.status, cell.today)}>
              <span className="visually-hidden">{checkinCellTitle(cell)}</span>
            </li>
          ))}
        </ol>
        <span>{row.checkin}</span>
      </div>
      {/* Three items carry three «Сделал», so each button names its own item to a reader. */}
      {canWrite ? (
        <div className="dashboard-today__mark">
          <button
            type="button"
            className={`dashboard-today__button${row.status === "done" ? " is-active" : ""}`}
            aria-label={`Сделал: ${row.title}`}
            aria-pressed={row.status === "done"}
            disabled={pending !== null}
            onClick={() => void mark("done")}
          >
            <Check size={13} aria-hidden="true" />
            Сделал
          </button>
          <button
            type="button"
            className={`dashboard-today__button${row.status === "skipped" ? " is-active" : ""}`}
            aria-label={`Пропустил: ${row.title}`}
            aria-pressed={row.status === "skipped"}
            disabled={pending !== null}
            onClick={() => void mark("skipped")}
          >
            <X size={13} aria-hidden="true" />
            Пропустил
          </button>
        </div>
      ) : null}
      {failed ? (
        <p className="dashboard-today__failed" role="alert">
          Отметка не сохранилась. Повторите попытку.
        </p>
      ) : null}
    </li>
  );
}

/**
 * «Сегодня» on the overview: the regimen the person accepted, marked where they already are. The
 * mark is written and the plan re-read, so the strip and the buttons state the server's answer.
 */
export function DashboardToday({
  rows,
  more,
  carePlanPath,
  today,
  canWrite,
  href,
  onRecorded,
}: {
  readonly rows: readonly DashboardTodayRow[];
  readonly more: string | null;
  readonly carePlanPath: string;
  readonly today: string;
  readonly canWrite: boolean;
  readonly href: string;
  readonly onRecorded: () => Promise<void>;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="dashboard-today" aria-labelledby="dashboard-today-title">
      <h4 id="dashboard-today-title">Сегодня</h4>
      <ul className="dashboard-today__items">
        {rows.map((row) => (
          <TodayItem
            key={row.id}
            row={row}
            itemPath={carePlanItemPath(carePlanPath, row.id)}
            today={today}
            canWrite={canWrite}
            onRecorded={onRecorded}
          />
        ))}
      </ul>
      {more === null ? null : (
        <p className="dashboard-today__more">
          <Link href={href}>{more}</Link>
        </p>
      )}
    </section>
  );
}
