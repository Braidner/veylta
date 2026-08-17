import type { SeriesPoint } from "../dossier";

interface SparklineProps {
  readonly points: readonly SeriesPoint[];
  readonly tone: "calm" | "watch";
}

const width = 120;
const height = 36;
const padding = 4;

/**
 * The confirmed values of one indicator over time, left to right, on a band that marks the
 * printed reference bounds when the source gives numeric ones. Purely the numbers: no smoothing,
 * no projection. Non-numeric readings («< 0,1») are skipped in the line but keep their slot.
 */
export function DossierSparkline({ points, tone }: SparklineProps) {
  const numeric = points.filter((point) => point.value !== null);
  if (numeric.length === 0) return null;
  const latest = points[points.length - 1];
  const bounds = [
    ...numeric.map((point) => point.value as number),
    ...numeric
      .flatMap((point) => [point.low, point.high])
      .filter((value): value is number => value !== null),
  ];
  const minimum = Math.min(...bounds);
  const maximum = Math.max(...bounds);
  const span = maximum - minimum || 1;
  const y = (value: number) =>
    height - padding - ((value - minimum) / span) * (height - 2 * padding);
  const x = (index: number) =>
    points.length === 1
      ? width / 2
      : padding + (index / (points.length - 1)) * (width - 2 * padding);
  const path = points
    .map((point, index) =>
      point.value === null ? null : `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`,
    )
    .filter((segment): segment is string => segment !== null)
    .join(" ");
  const band =
    latest?.low !== null && latest?.high !== null && latest !== undefined
      ? { top: y(latest.high as number), bottom: y(latest.low as number) }
      : latest?.high !== null && latest?.high !== undefined
        ? { top: y(latest.high), bottom: height - padding }
        : latest?.low !== null && latest?.low !== undefined
          ? { top: padding, bottom: y(latest.low) }
          : null;
  return (
    <svg
      className={`dossier-sparkline is-${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${numeric.length} подтверждённых значений во времени`}
      focusable="false"
    >
      {band !== null ? (
        <rect
          className="dossier-sparkline__band"
          x={0}
          y={Math.min(band.top, band.bottom)}
          width={width}
          height={Math.max(2, Math.abs(band.bottom - band.top))}
          rx={2}
        />
      ) : null}
      {numeric.length > 1 ? <polyline className="dossier-sparkline__line" points={path} /> : null}
      {points.map((point, index) =>
        point.value === null ? null : (
          <circle
            key={point.observationId}
            className={`dossier-sparkline__point${index === points.length - 1 ? " is-latest" : ""}`}
            cx={x(index)}
            cy={y(point.value)}
            r={index === points.length - 1 ? 3 : 1.8}
          />
        ),
      )}
    </svg>
  );
}
