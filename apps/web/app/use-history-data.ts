"use client";

import type {
  MedicalProfileResponse,
  ObservationHistoryItem,
  ObservationHistoryResponse,
} from "@veylta/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiRequest } from "./api-client";
import { medicalProfilePath } from "./components/medical-profile-controls";
import { passportOf } from "./dossier-passport";
import { profileApiPath } from "./paths";

export type HistoryDataState =
  | { kind: "loading" }
  | { kind: "error"; copy: string }
  | {
      kind: "ready";
      items: readonly ObservationHistoryItem[];
      sex: "female" | "male" | null;
      truncated: boolean;
    };

/** Bounded like the dossier: the newest pages of confirmed values; a household record fits. */
const historyPageLimit = 100;
const historyPages = 8;

/** How many confirmed values the page reads at most — what the truncation note tells the reader. */
export const historyValueCap = historyPageLimit * historyPages;

/**
 * A profile this session may not read answers 404, an expired session 401 — in both cases the
 * reader is told where to go rather than to retry, as every other panel of the shell says it.
 */
function historyErrorCopy(error: unknown): string {
  return error instanceof ApiError && [401, 404].includes(error.status)
    ? "История этого профиля недоступна. Вернитесь к доступному профилю и попробуйте снова."
    : "Не удалось загрузить историю. Подтверждённые значения и исходные документы не изменены.";
}

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
      // Both requests are awaited together: a lone `await` on the first would leave the second's
      // rejection unhandled when an unmount aborts the pair mid-flight.
      const [{ items, truncated }, profile] = await Promise.all([
        loadHistoryPages(base, signal),
        apiRequest<MedicalProfileResponse>(medicalProfilePath(familyId, profileId), { signal }),
      ]);
      if (signal.aborted) return;
      const passport = passportOf(profile.entries, new Date());
      setState({ kind: "ready", items, sex: passport.sex, truncated });
    } catch (error) {
      if (!signal.aborted) setState({ kind: "error", copy: historyErrorCopy(error) });
    }
  }, [familyId, profileId]);

  useEffect(() => {
    void load();
    return () => controllerRef.current?.abort();
  }, [load]);

  return { state, reload: () => void load() };
}
