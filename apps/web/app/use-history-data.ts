"use client";

import type {
  MedicalProfileResponse,
  ObservationHistoryItem,
  ObservationHistoryResponse,
} from "@veylta/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "./api-client";
import { medicalProfilePath } from "./components/medical-profile-controls";
import { passportOf } from "./dossier-passport";
import { profileApiPath } from "./paths";

export type HistoryDataState =
  | { kind: "loading" }
  | { kind: "error" }
  | {
      kind: "ready";
      items: readonly ObservationHistoryItem[];
      sex: "female" | "male" | null;
      truncated: boolean;
    };

/** Bounded like the dossier: the newest pages of confirmed values; a household record fits. */
const historyPageLimit = 100;
const historyPages = 8;

async function loadHistoryPages(
  base: string,
  signal: AbortSignal,
): Promise<{ items: ObservationHistoryItem[]; truncated: boolean }> {
  const items: ObservationHistoryItem[] = [];
  let cursor: string | null = null;
  let truncated = false;
  for (let page = 0; page < historyPages; page += 1) {
    const query = new URLSearchParams({ limit: String(historyPageLimit) });
    if (cursor !== null) query.set("cursor", cursor);
    const response = await apiRequest<ObservationHistoryResponse>(`${base}?${query.toString()}`, {
      signal,
    });
    items.push(...response.items);
    cursor = response.nextCursor;
    if (cursor === null) break;
    if (page === historyPages - 1) truncated = true;
  }
  return { items, truncated };
}

/** The full confirmed history plus the passport's sex — everything the trends read. */
export function useHistoryData(input: { familyId: string; profileId: string }): {
  state: HistoryDataState;
  reload: () => void;
} {
  const { familyId, profileId } = input;
  const [state, setState] = useState<HistoryDataState>({ kind: "loading" });
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const { signal } = controller;
    setState({ kind: "loading" });
    try {
      const base = `${profileApiPath(familyId, profileId)}/observations`;
      const profileRequest = apiRequest<MedicalProfileResponse>(
        medicalProfilePath(familyId, profileId),
        { signal },
      );
      const { items, truncated } = await loadHistoryPages(base, signal);
      const profile = await profileRequest;
      if (signal.aborted) return;
      const passport = passportOf(profile.entries, new Date());
      setState({ kind: "ready", items, sex: passport.sex, truncated });
    } catch {
      if (!signal.aborted) setState({ kind: "error" });
    }
  }, [familyId, profileId]);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return { state, reload: () => void load() };
}
