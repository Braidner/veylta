"use client";

import { ANALYTE_AREAS } from "@veylta/contracts";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import { type DossierSeries, dossierAreaLabel, seriesAssessment } from "../dossier";
import { formatSampleMoment } from "../format-moment";
import { profileTabPath } from "../paths";
import { countCopy } from "../russian-plural";
import { DossierSparkline } from "./dossier-sparkline";

interface DossierDynamicsProps {
  readonly familyId: string;
  readonly profileId: string;
  readonly series: readonly DossierSeries[];
  readonly loading: boolean;
}

const statusLabel = {
  above: "выше референса",
  below: "ниже референса",
  flagged: "вне референса",
  within: "в референсе",
  unknown: "без референса",
} as const;

function DeltaChip({ series }: { readonly series: DossierSeries }) {
  if (series.delta === null) return null;
  const Icon =
    series.delta.direction === "increased"
      ? ArrowUpRight
      : series.delta.direction === "decreased"
        ? ArrowDownRight
        : Minus;
  return (
    <span className="dossier-card__delta" title="Изменение с прошлого подтверждённого значения">
      <Icon size={13} aria-hidden="true" />
      {series.delta.direction === "unchanged" ? "без изменений" : series.delta.value}
    </span>
  );
}

function IndicatorCard({
  familyId,
  profileId,
  series,
}: {
  readonly familyId: string;
  readonly profileId: string;
  readonly series: DossierSeries;
}) {
  const assessment = seriesAssessment(series);
  const href =
    series.code === null
      ? profileTabPath(familyId, profileId, "history")
      : `${profileTabPath(familyId, profileId, "history")}&canonicalCode=${encodeURIComponent(series.code)}`;
  return (
    <li
      className={`dossier-card is-${assessment.tone} is-${series.status}`}
      data-testid="dossier-indicator"
    >
      <div className="dossier-card__head">
        <h4>{series.name}</h4>
        <span className="dossier-card__status">{statusLabel[series.status]}</span>
      </div>
      <div className="dossier-card__reading">
        <strong>{series.latest.printed}</strong>
        <span>{series.unit}</span>
        <DeltaChip series={series} />
      </div>
      <DossierSparkline points={series.points} tone={assessment.tone} />
      <p className="dossier-card__meta">
        <time dateTime={series.latest.at}>{formatSampleMoment(series.latest.at)}</time>
        {series.latest.rangeText === null ? null : (
          <span> · референс {series.latest.rangeText}</span>
        )}
        <span> · {countCopy(series.points.length, ["значение", "значения", "значений"])}</span>
      </p>
      <p className="dossier-card__assessment">{assessment.headline}</p>
      {assessment.nextStep === null ? null : (
        <p className="dossier-card__next">{assessment.nextStep.copy}</p>
      )}
      <Link className="dossier-card__link" href={href}>
        История показателя
      </Link>
    </li>
  );
}

/** Every confirmed indicator as a card, grouped by area, the values that need a look first. */
export function DossierDynamics({ familyId, profileId, series, loading }: DossierDynamicsProps) {
  const areas = ANALYTE_AREAS.map((area) => ({
    area,
    series: series
      .filter((item) => item.area === area)
      .sort(
        (a, b) =>
          Number(b.status !== "within") - Number(a.status !== "within") ||
          a.name.localeCompare(b.name, "ru-RU"),
      ),
  })).filter((group) => group.series.length > 0);
  return (
    <section
      className="dossier-dynamics"
      aria-labelledby="dossier-dynamics-title"
      aria-busy={loading}
    >
      <div className="dossier-section__heading">
        <div>
          <p className="context-line">Подтверждённые значения во времени</p>
          <h3 id="dossier-dynamics-title">Динамика показателей</h3>
        </div>
        <span>{countCopy(series.length, ["показатель", "показателя", "показателей"])}</span>
      </div>
      {loading ? <p className="dossier-empty">Собираем подтверждённые значения…</p> : null}
      {!loading && series.length === 0 ? (
        <p className="dossier-empty">
          Пока нет подтверждённых значений. Загрузите документ и подтвердите результаты — здесь
          появится динамика каждого показателя с оценкой против референса лаборатории.
        </p>
      ) : null}
      {areas.map((group) => (
        <div className="dossier-area" key={group.area}>
          <h4 className="dossier-area__title">
            {dossierAreaLabel[group.area]}
            <span>{group.series.length}</span>
          </h4>
          <ul className="dossier-area__grid">
            {group.series.map((item) => (
              <IndicatorCard
                key={item.key}
                familyId={familyId}
                profileId={profileId}
                series={item}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
