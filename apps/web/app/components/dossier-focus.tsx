"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { attentionBySpecialty, type DossierSeries } from "../dossier";
import {
  type AreaSummary,
  dossierAreaLabel,
  readersCopy,
  type StatusCounts,
  statusCounts,
  statusLine,
} from "../dossier-areas";
import { askQuestion, stashDossierAsk } from "../dossier-ask";
import { assistantAskPath } from "../paths";
import { useProfileHandle } from "../profile-route";
import { countCopy } from "../russian-plural";
import { DossierAttention } from "./dossier-attention";
import { GaugeCard } from "./dossier-gauge";
import { areaIcon, type DossierSelection } from "./dossier-rail";

interface DossierFocusProps {
  readonly familyId: string;
  readonly profileId: string;
  readonly selection: DossierSelection;
  readonly series: readonly DossierSeries[];
  readonly summaries: readonly AreaSummary[];
  readonly loading: boolean;
  readonly canWrite: boolean;
  readonly onSelect: (selection: DossierSelection) => void;
  readonly onPlanned: () => void;
}

/** Outside · within · without a reference, as proportional segments — counts, not a score. */
export function StatusStrip({ counts }: { readonly counts: StatusCounts }) {
  if (counts.total === 0) return null;
  return (
    <div className="dossier-strip" role="img" aria-label={statusLine(counts)}>
      {counts.outside > 0 ? (
        <span className="dossier-strip__segment is-outside" style={{ flexGrow: counts.outside }} />
      ) : null}
      {counts.within > 0 ? (
        <span className="dossier-strip__segment is-within" style={{ flexGrow: counts.within }} />
      ) : null}
      {counts.unknown > 0 ? (
        <span className="dossier-strip__segment is-unknown" style={{ flexGrow: counts.unknown }} />
      ) : null}
    </div>
  );
}

const outside = (series: DossierSeries): boolean =>
  series.status === "above" || series.status === "below" || series.status === "flagged";

/**
 * The right-hand page of the cabinet: the whole record or one area — a heading with what stands
 * where, the indicators that need a look first, then either the record's areas as tiles or the
 * area's remaining indicators. One shape for both, so a clinician reads every page the same way.
 */
export function DossierFocus({
  familyId,
  profileId,
  selection,
  series,
  summaries,
  loading,
  canWrite,
  onSelect,
  onPlanned,
}: DossierFocusProps) {
  const handle = useProfileHandle();
  const shown = selection === "all" ? series : series.filter((item) => item.area === selection);
  const counts = statusCounts(shown);
  const summary = selection === "all" ? null : summaries.find((item) => item.area === selection);
  const rest = shown
    .filter((item) => !outside(item))
    .sort((a, b) => a.name.localeCompare(b.name, "ru-RU"));
  const Icon = selection === "all" ? null : areaIcon[selection];
  return (
    <div className="dossier-focus" data-testid="dossier-focus">
      <header className="dossier-focus__head">
        <div>
          <h2>
            {Icon === null ? null : <Icon size={22} aria-hidden="true" />}
            {selection === "all" ? "Всё досье" : dossierAreaLabel[selection]}
          </h2>
          <p className="dossier-focus__line">
            {loading ? "Собираем подтверждённые значения…" : statusLine(counts)}
            {summary === undefined || summary === null ? "" : ` · ${readersCopy(summary.readers)}`}
          </p>
        </div>
        <div className="dossier-focus__aside">
          <StatusStrip counts={counts} />
          {selection === "all" && !loading && series.length > 0 ? (
            <Link
              className="button button--secondary dossier-focus__consilium"
              href={assistantAskPath(handle, "consilium")}
              onClick={() =>
                stashDossierAsk(window.sessionStorage, profileId, {
                  ask: "consilium",
                  question: askQuestion("consilium", series.filter(outside)),
                })
              }
            >
              <Users size={15} aria-hidden="true" />
              Собрать консилиум по досье
            </Link>
          ) : null}
        </div>
      </header>
      {!loading && series.length === 0 ? (
        <p className="dossier-empty">
          Пока нет подтверждённых значений. Загрузите документ и подтвердите результаты — здесь
          появится каждый показатель со шкалой референса и динамикой.
        </p>
      ) : (
        <DossierAttention
          familyId={familyId}
          profileId={profileId}
          groups={attentionBySpecialty(shown)}
          totalSeries={shown.length}
          loading={loading}
          canWrite={canWrite}
          showArea={selection === "all"}
          onPlanned={onPlanned}
        />
      )}
      {selection === "all" && summaries.length > 0 ? (
        <section className="dossier-areas" aria-labelledby="dossier-areas-title">
          <div className="dossier-section__heading">
            <h3 id="dossier-areas-title">Разделы досье</h3>
            <span>{countCopy(summaries.length, ["раздел", "раздела", "разделов"])}</span>
          </div>
          <ul className="dossier-areas__grid">
            {summaries.map((item) => {
              const TileIcon = areaIcon[item.area];
              return (
                <li key={item.area}>
                  <button
                    type="button"
                    className={`dossier-area-tile${item.outside > 0 ? " has-outside" : ""}`}
                    data-area={item.area}
                    onClick={() => onSelect(item.area)}
                  >
                    <span className="dossier-area-tile__head">
                      <TileIcon size={18} aria-hidden="true" />
                      <strong>{item.label}</strong>
                    </span>
                    <span className="dossier-area-tile__line">{statusLine(item)}</span>
                    <StatusStrip counts={item} />
                    <span className="dossier-area-tile__readers">{readersCopy(item.readers)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {selection !== "all" && rest.length > 0 ? (
        <section className="dossier-rest" aria-labelledby="dossier-rest-title">
          <div className="dossier-section__heading">
            <h3 id="dossier-rest-title">
              {counts.outside > 0 ? "Остальные показатели" : "Все показатели"}
            </h3>
            <span>{countCopy(rest.length, ["показатель", "показателя", "показателей"])}</span>
          </div>
          <ul className="dossier-gauges">
            {rest.map((item) => (
              <GaugeCard key={item.key} series={item} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
