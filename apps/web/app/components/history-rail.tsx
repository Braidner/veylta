"use client";

import { ANALYTE_AREAS, isOutsideRange } from "@veylta/contracts";
import { type ReactNode, useId, useState } from "react";
import type { DossierSeries } from "../dossier";
import { dossierAreaLabel } from "../dossier-areas";
import { countCopy } from "../russian-plural";
import { DeltaChip } from "./dossier-gauge";
import { DossierSparkline } from "./dossier-sparkline";

interface HistoryRailProps {
  readonly series: readonly DossierSeries[];
  readonly selectedKey: string | null;
  readonly onSelect: (series: DossierSeries) => void;
  /** What stands in place of the list while the page is loading or failed to load. */
  readonly state?: ReactNode;
}

interface AreaGroup {
  readonly area: (typeof ANALYTE_AREAS)[number];
  readonly series: readonly DossierSeries[];
}

function matchesQuery(series: DossierSeries, needle: string): boolean {
  if (needle.length === 0) return true;
  const code = series.code ?? "";
  return (
    series.name.toLocaleLowerCase("ru-RU").includes(needle) ||
    code.toLocaleLowerCase("ru-RU").includes(needle)
  );
}

function RailItem({
  series,
  selected,
  onSelect,
}: {
  readonly series: DossierSeries;
  readonly selected: boolean;
  readonly onSelect: (series: DossierSeries) => void;
}) {
  const values = countCopy(series.points.length, ["значение", "значения", "значений"]);
  return (
    <li>
      <button
        className={`history-rail__item${selected ? " is-selected" : ""}`}
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(series)}
      >
        <span className="history-rail__name" title={series.name}>
          {series.name}
        </span>
        <DossierSparkline
          points={series.points.map((point) => ({ id: point.observationId, value: point.value }))}
          band={{ low: series.latest.low, high: series.latest.high }}
          tone={isOutsideRange(series.status) ? "watch" : "calm"}
          label={`${series.name}: ${values} во времени`}
        />
        <span className="history-rail__value">
          {series.latest.printed} {series.unit}
        </span>
        <DeltaChip delta={series.delta} />
      </button>
    </li>
  );
}

/**
 * The record's indicators as a table of contents: a search field that narrows the list, then the
 * areas in the record's fixed order with a sparkline, the latest value and the change since last
 * time. On a narrow screen the same choice is a labelled select above the chart — one `onSelect`
 * behind both, so the two surfaces can never disagree. The `#indicator-catalog` anchor is here in
 * every state: a link into it must land even while the values are still loading.
 */
export function HistoryRail({ series, selectedKey, onSelect, state }: HistoryRailProps) {
  const [query, setQuery] = useState("");
  const selectId = useId();
  const needle = query.trim().toLocaleLowerCase("ru-RU");
  const matches = series.filter((entry) => matchesQuery(entry, needle));
  const groups: AreaGroup[] = ANALYTE_AREAS.flatMap((area) => {
    const own = matches.filter((entry) => entry.area === area);
    return own.length === 0 ? [] : [{ area, series: own }];
  });

  return (
    <div className="history-rail-side">
      <section id="indicator-catalog" className="history-filter">
        <label className="history-filter__label">
          <span className="visually-hidden">Найти показатель</span>
          <input
            className="history-filter__input"
            type="search"
            placeholder="Найти показатель"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
      </section>

      {/* The label wraps nothing: a `<select>` inside its own label folds every option into the
          accessible name. `htmlFor` keeps the name the one word it should be. */}
      <div className="history-rail__select">
        <label htmlFor={selectId}>Показатель</label>
        <select
          id={selectId}
          value={selectedKey ?? ""}
          onChange={(event) => {
            const chosen = series.find((entry) => entry.key === event.currentTarget.value);
            if (chosen !== undefined) onSelect(chosen);
          }}
        >
          {groups.map((group) => (
            <optgroup key={group.area} label={dossierAreaLabel[group.area]}>
              {group.series.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.name} · {entry.latest.printed} {entry.unit}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <nav className="history-rail" aria-label="Показатели">
        {state ?? (
          <>
            {groups.map((group) => (
              <div className="history-rail__group" key={group.area}>
                <h3 className="history-rail__area">{dossierAreaLabel[group.area]}</h3>
                <ul>
                  {group.series.map((entry) => (
                    <RailItem
                      key={entry.key}
                      series={entry}
                      selected={entry.key === selectedKey}
                      onSelect={onSelect}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {groups.length === 0 ? (
              <p className="history-rail__empty">
                {series.length === 0
                  ? "Показателей пока нет."
                  : "По этому запросу показателей нет — измените слово поиска."}
              </p>
            ) : null}
          </>
        )}
      </nav>
    </div>
  );
}
