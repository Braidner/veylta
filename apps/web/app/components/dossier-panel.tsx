"use client";

import type {
  MedicalProfileResponse,
  ObservationHistoryItem,
  ObservationHistoryResponse,
} from "@veylta/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api-client";
import { attentionBySpecialty, buildDossierSeries } from "../dossier";
import { passportOf } from "../dossier-passport";
import { DossierAttention } from "./dossier-attention";
import { DossierDynamics } from "./dossier-dynamics";
import { DossierPassport } from "./dossier-passport";
import { medicalProfilePath } from "./medical-profile-controls";
import { MedicalProfileSection } from "./medical-profile-section";

interface DossierPanelProps {
  readonly familyId: string;
  readonly profileId: string;
  readonly displayName: string;
  readonly canWriteProfile: boolean;
  /** Called after a visit is written into the care plan, so the plan on the same page can reload. */
  readonly onPlanChanged: () => void;
  /** Called after the medical profile changes here, so the heading's identity chips can reload. */
  readonly onProfileChanged: () => void;
}

/** Bounded: the newest pages of confirmed values; a household record fits well within this. */
const historyPageLimit = 100;
const historyPages = 8;

async function loadHistory(
  familyId: string,
  profileId: string,
  signal: AbortSignal,
): Promise<ObservationHistoryItem[]> {
  const base = `/v1/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}/observations`;
  const items: ObservationHistoryItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < historyPages; page += 1) {
    const query = new URLSearchParams({ limit: String(historyPageLimit) });
    if (cursor !== null) query.set("cursor", cursor);
    const response: ObservationHistoryResponse = await apiRequest<ObservationHistoryResponse>(
      `${base}?${query.toString()}`,
      { signal },
    );
    items.push(...response.items);
    cursor = response.nextCursor;
    if (cursor === null) break;
  }
  return items;
}

/**
 * The dossier's own data: the medical profile (who this is) and the confirmed values (what is
 * known), read once and turned into a passport, an attention list and the dynamics of every
 * indicator by the pure module. The summary and the care plan below keep their own loaders.
 */
export function DossierPanel({
  familyId,
  profileId,
  displayName,
  canWriteProfile,
  onPlanChanged,
  onProfileChanged,
}: DossierPanelProps) {
  const [profile, setProfile] = useState<MedicalProfileResponse | null>(null);
  const [history, setHistory] = useState<ObservationHistoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);

  const loadProfile = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await apiRequest<MedicalProfileResponse>(
          medicalProfilePath(familyId, profileId),
          signal === undefined ? undefined : { signal },
        );
        if (!signal?.aborted) setProfile(response);
      } catch {
        if (!signal?.aborted) setFailed(true);
      }
    },
    [familyId, profileId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile]);

  useEffect(() => {
    const controller = new AbortController();
    loadHistory(familyId, profileId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setHistory(items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [familyId, profileId]);

  const passport = useMemo(
    () => (profile === null ? null : passportOf(profile.entries, new Date())),
    [profile],
  );
  const series = useMemo(
    () => (history === null ? [] : buildDossierSeries(history, passport?.sex ?? null)),
    [history, passport],
  );
  const attention = useMemo(() => attentionBySpecialty(series), [series]);
  const canWrite = canWriteProfile && (profile?.canWrite ?? false);

  return (
    <div className="dossier" data-testid="dossier">
      <DossierPassport
        familyId={familyId}
        profileId={profileId}
        displayName={displayName}
        profile={profile}
        canWrite={canWrite}
        editing={editing}
        onToggleEditing={() => setEditing((current) => !current)}
        onChanged={() => {
          setProfileVersion((current) => current + 1);
          void loadProfile();
          onProfileChanged();
        }}
      />
      {editing ? (
        <MedicalProfileSection
          key={`editor:${profileVersion}`}
          familyId={familyId}
          profileId={profileId}
          canWriteProfile={canWriteProfile}
          onChanged={() => {
            void loadProfile();
            onProfileChanged();
          }}
        />
      ) : null}
      {failed ? (
        <p className="form-error" role="alert">
          Не удалось прочитать досье. Обновите страницу и попробуйте снова.
        </p>
      ) : null}
      <DossierAttention
        familyId={familyId}
        profileId={profileId}
        groups={attention}
        totalSeries={series.length}
        loading={history === null && !failed}
        canWrite={canWrite}
        onPlanned={onPlanChanged}
      />
      <DossierDynamics
        familyId={familyId}
        profileId={profileId}
        series={series}
        loading={history === null && !failed}
      />
    </div>
  );
}
