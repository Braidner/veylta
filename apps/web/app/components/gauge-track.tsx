import { gaugeScale, type ScaleReading } from "../dossier-scale";

interface GaugeTrackProps {
  readonly reading: ScaleReading;
  readonly label: string;
  /**
   * What to say instead when the source printed no pair of bounds. Null keeps the surface silent
   * — for a card whose own line already says the reference was not printed.
   */
  readonly fallback: string | null;
}

/**
 * The printed reference as a band on a track, the value as a marker — nothing graded, only placed.
 * Without printed bounds there is no track: a scale would be a number the document never carried.
 */
export function GaugeTrack({ reading, label, fallback }: GaugeTrackProps) {
  const scale = gaugeScale(reading);
  if (scale === null) {
    return fallback === null ? null : <p className="dossier-gauge__noscale">{fallback}</p>;
  }
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
