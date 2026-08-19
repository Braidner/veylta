"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import { type DossierSeries, seriesAssessment } from "../dossier";
import { dossierAreaLabel, readersCopy } from "../dossier-areas";
import { gaugeScale } from "../dossier-scale";
import { formatSampleMoment } from "../format-moment";
import { historyPath } from "../paths";
import { useProfileHandle } from "../profile-route";
import { countCopy } from "../russian-plural";
import { DossierSparkline } from "./dossier-sparkline";

interface GaugeCardProps {
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

export function DeltaChip({
  delta,
}: {
  readonly delta: { readonly value: string; readonly direction: string } | null;
}) {
  if (delta === null) return null;
  const Icon =
    delta.direction === "increased"
      ? ArrowUpRight
      : delta.direction === "decreased"
        ? ArrowDownRight
        : Minus;
  return (
    <span className="dossier-gauge__delta">
      <Icon size={12} aria-hidden="true" />
      {delta.direction === "unchanged" ? "0" : delta.value}
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
export function GaugeCard({ series, showArea = false }: GaugeCardProps) {
  const handle = useProfileHandle();
  const assessment = seriesAssessment(series);
  const href = series.code === null ? historyPath(handle) : historyPath(handle, series.code);
  return (
    <li
      className={`dossier-gauge is-${assessment.tone} is-${series.status}`}
      data-testid="dossier-gauge"
    >
      <h4 className="dossier-gauge__name" title={series.name}>
        {series.name}
      </h4>
      <div className="dossier-gauge__reading">
        <strong>{series.latest.printed}</strong>
        <span className="dossier-gauge__unit">{series.unit}</span>
        <span className="dossier-gauge__status">{statusLabel[series.status]}</span>
      </div>
      <ScaleTrack series={series} />
      {series.points.length > 1 ? (
        <DossierSparkline
          points={series.points.map((point) => ({ id: point.observationId, value: point.value }))}
          band={{ low: series.latest.low, high: series.latest.high }}
          tone={assessment.tone}
          label={`${countCopy(series.points.length, ["значение", "значения", "значений"])} во времени`}
        />
      ) : null}
      <p className="dossier-gauge__meta">
        <time dateTime={series.latest.at}>{formatSampleMoment(series.latest.at)}</time>
        <span> · {countCopy(series.points.length, ["значение", "значения", "значений"])}</span>
        {series.delta === null ? null : (
          <span>
            {" "}
            · <DeltaChip delta={series.delta} /> с прошлого раза
          </span>
        )}
        {assessment.repeat.length > 0 ? <span> · {assessment.repeat}</span> : null}
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
