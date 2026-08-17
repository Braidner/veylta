"use client";

import type {
  MedicalProfileEntry,
  MedicalProfileEntryResponse,
  MedicalProfileResponse,
} from "@veylta/contracts";
import { type FormEvent, useCallback, useEffect, useId, useState } from "react";
import { ApiError, apiRequest } from "../api-client";
import {
  isSingletonKind,
  medicalProfileGroups,
  medicalProfileReadinessCopy,
} from "../medical-profile";
import {
  type Draft,
  medicalProfileErrorCopy,
  medicalProfilePath,
} from "./medical-profile-controls";
import { MedicalProfileGroup } from "./medical-profile-group";

type SectionState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; profile: MedicalProfileResponse };

export function MedicalProfileSection({
  familyId,
  profileId,
  canWriteProfile,
  onChanged,
}: {
  familyId: string;
  profileId: string;
  canWriteProfile: boolean;
  /** Told after every saved change, so a passport above can re-read the profile. */
  onChanged?: () => void;
}) {
  const formId = useId();
  const path = medicalProfilePath(familyId, profileId);
  const [state, setState] = useState<SectionState>({ kind: "loading" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const profile = await apiRequest<MedicalProfileResponse>(
          path,
          signal ? { signal } : undefined,
        );
        if (!signal?.aborted) setState({ kind: "ready", profile });
      } catch {
        if (!signal?.aborted) setState({ kind: "error" });
      }
    },
    [path],
  );

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function mutate(request: () => Promise<MedicalProfileEntryResponse>): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      await request();
      await load();
      onChanged?.();
      return true;
    } catch (caught) {
      setError(medicalProfileErrorCopy(caught));
      if (caught instanceof ApiError && caught.status === 409) await load();
      return false;
    } finally {
      setPending(false);
    }
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (draft === null || draft.value.trim().length === 0) return;
    const saved = await mutate(() =>
      apiRequest<MedicalProfileEntryResponse>(`${path}/entries/${crypto.randomUUID()}`, {
        method: "PUT",
        body: JSON.stringify({
          kind: draft.kind,
          value: draft.value.trim(),
          recordedOn: draft.recordedOn === "" ? null : draft.recordedOn,
        }),
      }),
    );
    if (saved) setDraft(null);
  }

  function archive(entry: MedicalProfileEntry): void {
    void mutate(() =>
      apiRequest<MedicalProfileEntryResponse>(`${path}/entries/${entry.id}/archive`, {
        method: "PUT",
        body: JSON.stringify({ revision: entry.revision }),
      }),
    );
  }

  const profile = state.kind === "ready" ? state.profile : null;
  const canWrite = canWriteProfile && (profile?.canWrite ?? false);
  const readiness = profile === null ? null : medicalProfileReadinessCopy(profile.entries);

  return (
    <section
      className="medical-profile"
      aria-labelledby={`${formId}-title`}
      aria-busy={state.kind === "loading"}
      data-testid="medical-profile"
    >
      <div className="medical-profile__heading">
        <div>
          <p>О человеке</p>
          <h3 id={`${formId}-title`}>Медицинский профиль</h3>
          <span>
            То, что вы записываете о себе для ассистентов: пол, возраст, состояния, лекарства,
            ограничения и цели. Ничего из этого Veylta не выводит сама.
          </span>
        </div>
      </div>
      {state.kind === "error" ? (
        <p className="medical-profile__notice" role="alert">
          Не удалось загрузить профиль. Обновите страницу.
        </p>
      ) : null}
      {readiness !== null ? (
        <p className="medical-profile__notice medical-profile__notice--readiness" role="status">
          {readiness}
        </p>
      ) : null}
      {error !== null ? (
        <p className="medical-profile__notice" role="alert">
          {error}
        </p>
      ) : null}
      {profile === null ? null : (
        <div className="medical-profile__groups">
          {medicalProfileGroups.map((group) => {
            const entries = profile.entries.filter((entry) => group.kinds.includes(entry.kind));
            const addableKinds = group.kinds.filter(
              (kind) => !isSingletonKind(kind) || !entries.some((entry) => entry.kind === kind),
            );
            const open = draft?.groupId === group.id;
            return (
              <MedicalProfileGroup
                key={group.id}
                group={group}
                entries={entries}
                addableKinds={addableKinds}
                canWrite={canWrite}
                pending={pending}
                draft={open && draft !== null ? draft : null}
                formId={formId}
                onStart={() =>
                  setDraft({
                    groupId: group.id,
                    kind: addableKinds[0] ?? group.kinds[0] ?? "note",
                    value: "",
                    recordedOn: "",
                  })
                }
                onDraftChange={setDraft}
                onSubmit={(event) => void submitDraft(event)}
                onArchive={archive}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
