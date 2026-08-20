"use client";

import { useMemo } from "react";
import type { DossierSeries } from "../dossier";
import { formatSampleMoment } from "../format-moment";
import { type ChartPoint, historyChartModel } from "../history-chart";
import type { HistoryPeriod } from "../history-summary";
import { documentPath } from "../paths";
import { useProfileHandle } from "../profile-route";

interface HistoryChartProps {
  readonly series: DossierSeries;
  readonly period: HistoryPeriod;
  /** The page's clock, so the chart's axis and the summary's window are the same period. */
  readonly now: Date;
}

/** Colour never carries a status alone: every tone is named beside its dot. */
const legend = [
  { status: "within", label: "в референсе" },
  { status: "above", label: "вне референса" },
  { status: "unknown", label: "без референса" },
] as const;

/**
 * One indicator over the period: the laboratory's printed reference as a stepped band, the
 * confirmed values on it, each point a link to the document it came from. The drawing stretches
 * to its box (`preserveAspectRatio="none"`), so strokes and dots keep their screen size through
 * `vector-effect` — a round-capped zero-length line stays a circle where a `<circle>` would
 * flatten into an ellipse.
 */
export function HistoryChart({ series, period, now }: HistoryChartProps) {
  const handle = useProfileHandle();
  const model = useMemo(() => historyChartModel(series, period, now), [series, period, now]);

  if (model.empty === "no_numeric") {
    return (
      <figure className="history-chart history-chart--empty">
        <p>
          В выбранном периоде нет числовых значений. Таблица ниже показывает всё, что подтверждено.
        </p>
      </figure>
    );
  }

  const line = model.points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  return (
    <figure className="history-chart">
      <div className="history-chart__plot">
        <span className="history-chart__y is-max">{model.yMaxLabel}</span>
        <span className="history-chart__y is-min">{model.yMinLabel}</span>
        <svg
          className="history-chart__svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${series.name}: значения за период против референса лаборатории`}
        >
          {model.band.map((segment) => (
            <rect
              className="history-chart__band"
              key={segment.since}
              x={segment.x1}
              y={Math.min(segment.yTop, segment.yBottom)}
              width={Math.max(segment.x2 - segment.x1, 0.4)}
              height={Math.max(Math.abs(segment.yBottom - segment.yTop), 0.6)}
            />
          ))}
          {model.points.length > 1 ? (
            <polyline
              className="history-chart__line"
              points={line}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {model.points.map((point) => (
            <PointLink key={point.observationId} point={point} unit={series.unit} handle={handle} />
          ))}
        </svg>
      </div>

      <div className="history-chart__ticks" aria-hidden="true">
        {model.ticks.map((tick) => (
          <span key={tick.x}>{tick.label}</span>
        ))}
      </div>

      <ul className="history-chart__legend" aria-label="Как читать точки">
        {legend.map((item) => (
          <li key={item.status}>
            <span className={`history-chart__key is-${item.status}`} aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>

      <figcaption>
        Точки — подтверждённые значения; полоса — референс из документа той же лаборатории. Точные
        значения и источники — в таблице ниже.
      </figcaption>
    </figure>
  );
}

function PointLink({
  point,
  unit,
  handle,
}: {
  readonly point: ChartPoint;
  readonly unit: string;
  readonly handle: string;
}) {
  const moment = formatSampleMoment(point.at.slice(0, 10));
  const text = `${point.printed} ${unit} · ${moment}${point.laboratory === null ? "" : ` · ${point.laboratory}`}`;
  return (
    <a
      className={`history-chart__point is-${point.status}`}
      href={documentPath(handle, point.documentId)}
      aria-label={text}
    >
      <title>{text}</title>
      <line x1={point.x} y1={point.y} x2={point.x} y2={point.y} vectorEffect="non-scaling-stroke" />
    </a>
  );
}
