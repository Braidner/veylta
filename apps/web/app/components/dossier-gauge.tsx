"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import { type DossierSeries, seriesAssessment } from "../dossier";
import { dossierAreaLabel, readersCopy } from "../dossier-areas";
import { gaugeScale } from "../dossier-scale";
import { formatSampleMoment } from "../format-moment";
import { profileTabPath } from "../paths";
import { countCopy } from "../russian-plural";
import { DossierSparkline } from "./dossier-sparkline";

interface GaugeCardProps {
  readonly familyId: string;
  readonly profileId: string;
  readonly series: DossierSeries;
  /** In the whole-record views a card also says which area it belongs to and who reads it. */
  readonly showArea?: boolean;
}

export const statusLabel = {
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
    <span className="dossier-gauge__delta" title="Изменение с прошлого подтверждённого значения">
      <Icon size={13} aria-hidden="true" />
      {series.delta.direction === "unchanged" ? "без изменений" : series.delta.value}
    </span>
  );
}

/** The printed reference as a band on a track, the value as a marker — nothing graded, only placed. */
function ScaleTrack({ series }: { readonly series: DossierSeries }) {
  const scale = gaugeScale(series.latest);
  if (scale === null) {
    return (
      <p className="dossier-gauge__noscale">
        {series.latest.rangeText === null
          ? "Референс не напечатан"
          : `Референс: ${series.latest.rangeText}`}
      </p>
    );
  }
  const label = `Референс ${series.latest.rangeText ?? ""}: значение ${statusLabel[series.status]}`;
  return (
    <div className="dossier-gauge__scale" role="img" aria-label={label}>
      <div className="dossier-gauge__track">
        <span
          className="dossier-gauge__band"
          style={{ left: `${scale.band.from}%`, width: `${scale.band.to - scale.band.from}%` }}
        />
        {scale.marker === null ? null : (
          <span className="dossier-gauge__marker" style={{ left: `${scale.marker}%` }} />
        )}
      </div>
      <div className="dossier-gauge__bounds" aria-hidden="true">
        {scale.lowLabel === null ? null : (
          <span
            style={{
              left: `${scale.band.from}%`,
              transform: `translateX(-${scale.band.from}%)`,
            }}
          >
            {scale.lowLabel}
          </span>
        )}
        {scale.highLabel === null ? null : (
          <span style={{ left: `${scale.band.to}%`, transform: `translateX(-${scale.band.to}%)` }}>
            {scale.highLabel}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * One indicator the way a clinician scans it: name and where it stands, the number, the printed
 * reference as a scale with the value on it, the change since last time, and the way to its
 * history. Colour appears only where the source's own reference puts the value outside.
 */
export function GaugeCard({ familyId, profileId, series, showArea = false }: GaugeCardProps) {
  const assessment = seriesAssessment(series);
  const history = profileTabPath(familyId, profileId, "history");
  const href =
    series.code === null ? history : `${history}&canonicalCode=${encodeURIComponent(series.code)}`;
  return (
    <li
      className={`dossier-gauge is-${assessment.tone} is-${series.status}`}
      data-testid="dossier-gauge"
    >
      <div className="dossier-gauge__head">
        <h4>{series.name}</h4>
        <span className="dossier-gauge__status">{statusLabel[series.status]}</span>
      </div>
      <div className="dossier-gauge__reading">
        <strong>{series.latest.printed}</strong>
        <span>{series.unit}</span>
        <DeltaChip series={series} />
      </div>
      <ScaleTrack series={series} />
      {series.points.length > 1 ? (
        <DossierSparkline points={series.points} tone={assessment.tone} />
      ) : null}
      <p className="dossier-gauge__meta">
        <time dateTime={series.latest.at}>{formatSampleMoment(series.latest.at)}</time>
        <span> · {countCopy(series.points.length, ["значение", "значения", "значений"])}</span>
        {series.points.length > 1 ? <span> · {assessment.detail}</span> : null}
      </p>
      <div className="dossier-gauge__foot">
        {showArea ? (
          <span>
            {dossierAreaLabel[series.area]} · {readersCopy([series.specialty])}
          </span>
        ) : null}
        <Link className="dossier-gauge__link" href={href}>
          История
        </Link>
      </div>
    </li>
  );
}
