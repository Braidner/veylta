"use client";

import type { ObservationHistoryItem } from "@veylta/contracts";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildDossierSeries, type DossierSeries, seriesKeyOf } from "../dossier";
import { formatSampleMoment } from "../format-moment";
import { chooseSelectionKey } from "../history-selection";
import type { HistoryPeriod } from "../history-summary";
import { historyPath } from "../paths";
import { useProfileHandle } from "../profile-route";
import { type HistoryDataState, useHistoryData } from "../use-history-data";
import { statusLabel } from "./dossier-gauge";
import { HistoryChart } from "./history-chart";
import { HistoryRail } from "./history-rail";
import { HistorySummaryPanel } from "./history-summary";
import { HistoryTable } from "./history-table";

interface HistoryWorkspaceProps {
  readonly familyId: string;
  readonly profileId: string;
  /** The `?code=` of the URL: what a link from the dossier or a document page asked to see. */
  readonly requestedCanonicalCode?: string | undefined;
}

const noItems: readonly ObservationHistoryItem[] = [];

/**
 * The history page: what the period changed, the record's indicators to choose from, and the
 * chosen one against the reference its laboratory printed — with every value's source under it.
 * One read of the confirmed values feeds all four; the dossier's own series rule does the rest.
 *
 * The cabinet stands in every state, so `#observation-history` and `#indicator-catalog` exist
 * before the values arrive: a hash the router cannot match at first paint is dropped, not retried.
 */
export function HistoryWorkspace({
  familyId,
  profileId,
  requestedCanonicalCode,
}: HistoryWorkspaceProps) {
  const router = useRouter();
  const handle = useProfileHandle();
  const { state, reload } = useHistoryData({ familyId, profileId });
  const [period, setPeriod] = useState<HistoryPeriod>("6m");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedCode = useRef<string | null | undefined>(undefined);

  const items = state.kind === "ready" ? state.items : noItems;
  const sex = state.kind === "ready" ? state.sex : null;
  const series = useMemo(() => buildDossierSeries(items, sex), [items, sex]);
  // The page reads one clock: the summary's window and the chart's axis are the same period.
  const now = useMemo(() => new Date(), []);

  const chosen = useMemo(() => {
    const key = chooseSelectionKey({
      local: selectedKey,
      requestedCode: requestedCanonicalCode,
      series,
    });
    return series.find((entry) => entry.key === key) ?? null;
  }, [series, selectedKey, requestedCanonicalCode]);

  // A `?code=` arriving from elsewhere re-selects; the code this page has just written back does
  // not, so a unit chip chosen inside one code survives its own URL update.
  useEffect(() => {
    if (requestedCanonicalCode !== undefined && requestedCanonicalCode === selectedCode.current) {
      return;
    }
    setSelectedKey(null);
  }, [requestedCanonicalCode]);

  const select = (entry: DossierSeries) => {
    setSelectedKey(entry.key);
    selectedCode.current = entry.code;
    // The URL stays shareable for a mapped indicator; a printed-name-only series has no code.
    if (entry.code !== null) router.replace(historyPath(handle, entry.code), { scroll: false });
  };

  const units =
    chosen === null || chosen.code === null
      ? []
      : series.filter((entry) => entry.code === chosen.code);
  const rows = chosen === null ? noItems : items.filter((item) => seriesKeyOf(item) === chosen.key);

  return (
    <div className="history-workspace" data-testid="history">
      {chosen === null ? null : (
        <HistorySummaryPanel
          series={series}
          period={period}
          now={now}
          onPeriodChange={setPeriod}
          onSelect={select}
        />
      )}
      <div className="history-cabinet">
        <HistoryRail
          series={series}
          selectedKey={chosen?.key ?? null}
          onSelect={select}
          state={railState(state)}
        />
        <div className="history-main">
          {chosen === null ? null : (
            <>
              {units.length > 1 ? (
                <fieldset className="history-units">
                  <legend className="visually-hidden">Единица измерения</legend>
                  {units.map((entry) => (
                    <button
                      key={entry.key}
                      className="history-units__chip"
                      type="button"
                      aria-pressed={entry.key === chosen.key}
                      onClick={() => select(entry)}
                    >
                      {entry.unit}
                    </button>
                  ))}
                </fieldset>
              ) : null}
              <div className="history-main__head">
                <h3>{chosen.name}</h3>
                <p>
                  {chosen.latest.printed} {chosen.unit} · {statusLabel[chosen.status]} ·{" "}
                  <time dateTime={chosen.latest.at}>{formatSampleMoment(chosen.latest.at)}</time>
                </p>
              </div>
              <HistoryChart series={chosen} period={period} now={now} />
            </>
          )}
          <HistoryTable
            series={chosen}
            items={rows}
            truncated={state.kind === "ready" && state.truncated}
            state={valuesState(state, reload)}
          />
        </div>
      </div>
    </div>
  );
}

/** The rail says only where the list is; the failure itself is told once, beside the values. */
function railState(state: HistoryDataState) {
  if (state.kind === "ready") return undefined;
  return (
    <p className="history-rail__empty">
      {state.kind === "loading" ? "Загружаем показатели…" : "Показатели не загрузились."}
    </p>
  );
}

function valuesState(state: HistoryDataState, reload: () => void) {
  if (state.kind === "loading") {
    return (
      <div className="history-workspace__state" aria-live="polite">
        <div className="skeleton skeleton--history-heading" aria-hidden="true" />
        <div className="skeleton skeleton--history-row" aria-hidden="true" />
        <p>Загружаем подтверждённые значения и их источники…</p>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="history-workspace__state" role="status">
        <p>{state.copy}</p>
        <button className="button button--secondary" type="button" onClick={reload}>
          Обновить
        </button>
      </div>
    );
  }
  return undefined;
}
