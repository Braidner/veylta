"use client";

import { useMemo } from "react";
import type { DossierSeries } from "../dossier";
import {
  HISTORY_PERIODS,
  type HistoryPeriod,
  historyBucketLabel,
  historyPeriodLabel,
  historySummary,
} from "../history-summary";
import { countCopy } from "../russian-plural";

interface HistorySummaryPanelProps {
  readonly series: readonly DossierSeries[];
  readonly period: HistoryPeriod;
  /** The clock enters the page once, in the workspace, so summary and chart read the same window. */
  readonly now: Date;
  readonly onPeriodChange: (period: HistoryPeriod) => void;
  readonly onSelect: (series: DossierSeries) => void;
}

/**
 * What the period did to the record, by the dossier's status rule and nothing else: how many
 * indicators moved outside their printed reference, how many came back, how many stayed, how many
 * were measured for the first time — each count with the indicators behind it, one click from the
 * chart below. Counts, never a score.
 */
export function HistorySummaryPanel({
  series,
  period,
  now,
  onPeriodChange,
  onSelect,
}: HistorySummaryPanelProps) {
  const summary = useMemo(() => historySummary(series, period, now), [series, period, now]);

  return (
    <section className="history-summary" aria-labelledby="history-summary-title">
      <div className="history-summary__head">
        <div>
          <p className="context-line">Подтверждённые значения</p>
          <h2 id="history-summary-title">Что изменилось</h2>
          <p className="history-summary__line">
            {countCopy(summary.measuredCount, ["показатель", "показателя", "показателей"])} с
            измерениями за период
          </p>
          <p className="history-summary__rule">
            Считаем по референсу лаборатории: вышло значение за референс или вернулось в него.
          </p>
        </div>
        <fieldset className="history-summary__periods">
          <legend className="visually-hidden">Период</legend>
          {HISTORY_PERIODS.map((option) => (
            <button
              key={option}
              className="history-summary__period"
              type="button"
              aria-pressed={option === period}
              onClick={() => onPeriodChange(option)}
            >
              {historyPeriodLabel[option]}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="history-summary__counts">
        {summary.buckets.map((bucket) => (
          <div className="history-summary__bucket" key={bucket.kind} data-bucket={bucket.kind}>
            <strong className="history-summary__count">{bucket.series.length}</strong>
            <span className="history-summary__label">{historyBucketLabel[bucket.kind]}</span>
            {bucket.series.length > 0 ? (
              <ul className="history-summary__chips">
                {bucket.series.map((entry) => (
                  <li key={entry.key}>
                    <button
                      className="history-summary__chip"
                      type="button"
                      onClick={() => onSelect(entry)}
                    >
                      {entry.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
