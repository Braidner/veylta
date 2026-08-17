"use client";

import type { MedicalProfileEntryResponse, MedicalProfileResponse } from "@veylta/contracts";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { apiRequest } from "../api-client";
import { bodyMassIndex, type MeasurementSeries, measurementSeries } from "../dossier-passport";
import { DeltaChip } from "./dossier-gauge";
import { DossierSparkline } from "./dossier-sparkline";
import { medicalProfileErrorCopy, medicalProfilePath } from "./medical-profile-controls";

interface DossierMeasurementsProps {
  readonly familyId: string;
  readonly profileId: string;
  readonly profile: MedicalProfileResponse;
  readonly canWrite: boolean;
  readonly onChanged: () => void;
}

type MeasurementKind = "weight_kg" | "height_cm";

const dateCopy = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
const localToday = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${String(now.getDate()).padStart(2, "0")}`;
};

/**
 * One row of the passport's measurements: the latest number as written, how it moved, its own
 * small history, and — once a month, or while nothing is recorded — the invitation to write it
 * down again. A new value is a new dated entry; the previous one is archived, never overwritten,
 * so the series stays the person's own record.
 */
function MeasurementRow({
  familyId,
  profileId,
  kind,
  label,
  unit,
  series,
  active,
  canWrite,
  onChanged,
}: {
  readonly familyId: string;
  readonly profileId: string;
  readonly kind: MeasurementKind;
  readonly label: string;
  readonly unit: string;
  readonly series: MeasurementSeries;
  readonly active: { readonly id: string; readonly revision: number } | null;
  readonly canWrite: boolean;
  readonly onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The field opens on the person's own click, so focus follows them into it.
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (draft.trim() === "") return;
    setPending(true);
    setError(null);
    try {
      const base = medicalProfilePath(familyId, profileId);
      if (active !== null) {
        await apiRequest<MedicalProfileEntryResponse>(`${base}/entries/${active.id}/archive`, {
          method: "PUT",
          body: JSON.stringify({ revision: active.revision }),
        });
      }
      await apiRequest<MedicalProfileEntryResponse>(`${base}/entries/${crypto.randomUUID()}`, {
        method: "PUT",
        body: JSON.stringify({ kind, value: draft.trim(), recordedOn: localToday() }),
      });
      setEditing(false);
      setDraft("");
      onChanged();
    } catch (caught) {
      setError(medicalProfileErrorCopy(caught));
    } finally {
      setPending(false);
    }
  }

  const latest = series.latest;
  const when = latest === null ? null : dateCopy.format(new Date(`${latest.on}T00:00:00`));
  return (
    <li
      className={`dossier-measure${series.stale && canWrite ? " is-stale" : ""}`}
      data-testid={`dossier-measure-${kind}`}
    >
      <span className="dossier-measure__label">{label}</span>
      {editing ? (
        <form className="dossier-measure__form" onSubmit={save}>
          <label>
            <span className="visually-hidden">
              {label}, {unit}
            </span>
            <input
              ref={inputRef}
              inputMode="decimal"
              placeholder={latest === null ? unit : latest.printed}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={pending}
            />
          </label>
          <span className="dossier-measure__unit">{unit}</span>
          <button className="button button--primary" type="submit" disabled={pending}>
            {pending ? "…" : "Сохранить"}
          </button>
          <button
            className="dossier-measure__cancel"
            type="button"
            onClick={() => setEditing(false)}
            disabled={pending}
          >
            Отмена
          </button>
          {error !== null ? (
            <span className="form-error" role="alert">
              {error}
            </span>
          ) : null}
        </form>
      ) : (
        <>
          <div className="dossier-measure__main">
            <span className="dossier-measure__value">
              {latest === null ? (
                <em>не указан</em>
              ) : (
                <>
                  <strong>{latest.printed}</strong> {unit}
                  <DeltaChip delta={series.delta} />
                </>
              )}
            </span>
            {canWrite ? (
              <button
                type="button"
                className="dossier-measure__update"
                onClick={() => {
                  setDraft("");
                  setEditing(true);
                }}
              >
                {latest === null ? "Указать" : "Обновить"}
              </button>
            ) : null}
          </div>
          {latest === null ? null : (
            <div className="dossier-measure__trend">
              {series.points.length > 1 ? (
                <DossierSparkline
                  points={series.points.map((point, index) => ({
                    id: `${point.on}:${index}`,
                    value: point.value,
                  }))}
                  tone="calm"
                  label={`${label}: ${series.points.length} записей во времени`}
                />
              ) : (
                <span className="dossier-measure__spacer" />
              )}
              <span className="dossier-measure__when">
                {series.stale ? `${when} · пора обновить` : when}
              </span>
            </div>
          )}
        </>
      )}
    </li>
  );
}

/** Weight and height as the person's own series, with the BMI of the latest pair as a number. */
export function DossierMeasurements({
  familyId,
  profileId,
  profile,
  canWrite,
  onChanged,
}: DossierMeasurementsProps) {
  const now = new Date();
  const weight = measurementSeries(profile.measurements.weightKg, now);
  const height = measurementSeries(profile.measurements.heightCm, now);
  const bmi = bodyMassIndex(height.latest?.value ?? null, weight.latest?.value ?? null);
  const active = (kind: MeasurementKind) => {
    const entry = profile.entries.find((item) => item.kind === kind);
    return entry === undefined ? null : { id: entry.id, revision: entry.revision };
  };
  return (
    <ul className="dossier-measures" aria-label="Измерения">
      <MeasurementRow
        familyId={familyId}
        profileId={profileId}
        kind="weight_kg"
        label="Вес"
        unit="кг"
        series={weight}
        active={active("weight_kg")}
        canWrite={canWrite}
        onChanged={onChanged}
      />
      <MeasurementRow
        familyId={familyId}
        profileId={profileId}
        kind="height_cm"
        label="Рост"
        unit="см"
        series={height}
        active={active("height_cm")}
        canWrite={canWrite}
        onChanged={onChanged}
      />
      {bmi === null ? null : (
        <li className="dossier-measure" data-testid="dossier-measure-bmi">
          <span className="dossier-measure__label">ИМТ</span>
          <span className="dossier-measure__value">
            <strong>{bmi.toFixed(1).replace(".", ",")}</strong>
          </span>
        </li>
      )}
    </ul>
  );
}
