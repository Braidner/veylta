interface SparklineProps {
  readonly points: readonly { readonly id: string; readonly value: number | null }[];
  /** The printed reference of the latest point, drawn as a band; either bound may be missing. */
  readonly band?: { readonly low: number | null; readonly high: number | null } | null;
  readonly tone: "calm" | "watch";
  readonly label: string;
}

const width = 100;
const height = 40;
const pad = 5;

/**
 * Values over time, left to right, on a band that marks the printed reference when there is one.
 * Purely the numbers: no smoothing, no projection. The drawing stretches to its box; strokes and
 * dots keep their screen size (`vector-effect`), so a wide card and a narrow one read alike.
 * Non-numeric readings («< 0,1») are skipped in the line but keep their slot.
 */
export function DossierSparkline({ points, band = null, tone, label }: SparklineProps) {
  const numeric = points.filter((point) => point.value !== null);
  if (numeric.length === 0) return null;
  const domain = [
    ...numeric.map((point) => point.value as number),
    ...(band === null ? [] : [band.low, band.high]).filter(
      (value): value is number => value !== null,
    ),
  ];
  const minimum = Math.min(...domain);
  const maximum = Math.max(...domain);
  const span = maximum - minimum || 1;
  const y = (value: number) => height - pad - ((value - minimum) / span) * (height - 2 * pad);
  const x = (index: number) =>
    points.length === 1 ? width / 2 : pad + (index / (points.length - 1)) * (width - 2 * pad);
  const line = points
    .map((point, index) =>
      point.value === null ? null : `${x(index).toFixed(2)},${y(point.value).toFixed(2)}`,
    )
    .filter((segment): segment is string => segment !== null)
    .join(" ");
  const bandTop = band === null ? null : band.high === null ? pad : y(band.high);
  const bandBottom = band === null ? null : band.low === null ? height - pad : y(band.low);
  const lastIndex = points.length - 1;
  return (
    <svg
      className={`dossier-sparkline is-${tone}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      focusable="false"
    >
      {bandTop !== null && bandBottom !== null && (band?.low !== null || band?.high !== null) ? (
        <rect
          className="dossier-sparkline__band"
          x={0}
          y={Math.min(bandTop, bandBottom)}
          width={width}
          height={Math.max(1.5, Math.abs(bandBottom - bandTop))}
        />
      ) : null}
      {numeric.length > 1 ? (
        <polyline
          className="dossier-sparkline__line"
          points={line}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {points.map((point, index) =>
        point.value === null ? null : (
          <line
            key={point.id}
            className={`dossier-sparkline__point${index === lastIndex ? " is-latest" : ""}`}
            x1={x(index)}
            y1={y(point.value)}
            x2={x(index)}
            y2={y(point.value)}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </svg>
  );
}
