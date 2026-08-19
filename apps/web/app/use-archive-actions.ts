"use client";

import type {
  DocumentFactsResponse,
  DocumentProcessingRestartResponse,
  FactReviewResponse,
  ProfileOverviewDocument,
  ProfileOverviewReviewDocument,
} from "@veylta/contracts";
import { useState } from "react";
import { apiRequest } from "./api-client";
import { bulkConfirmableCount, canBulkConfirmFact, isRestartable } from "./documents-archive";
import { documentApiPath } from "./paths";

export type ArchiveActionState =
  | { kind: "idle" }
  | { kind: "confirming"; completed: number; total: number; documentId: string | null }
  | { kind: "restarting"; documentId: string | null }
  | { kind: "error"; copy: string };

/**
 * Bulk confirm and restart as they were in the overview panel: every decision is its own
 * idempotent command, a failure part-way says how far it got, and the overview is reloaded after.
 */
export function useArchiveActions(input: {
  familyId: string;
  profileId: string;
  reload: () => Promise<void>;
}) {
  const [action, setAction] = useState<ArchiveActionState>({ kind: "idle" });

  async function confirmDocuments(
    documents: readonly ProfileOverviewReviewDocument[],
  ): Promise<void> {
    const queue = documents.filter((document) => bulkConfirmableCount(document) > 0);
    if (queue.length === 0) return;
    const single = queue.length === 1 ? (queue[0]?.id ?? null) : null;
    setAction({ kind: "confirming", completed: 0, total: 0, documentId: single });
    let completed = 0;
    let total = 0;
    try {
      for (const document of queue) {
        const facts = `${documentApiPath(input.familyId, input.profileId, document.id)}/facts`;
        const response = await apiRequest<DocumentFactsResponse>(facts);
        const confirmable = response.items.filter(canBulkConfirmFact);
        total += confirmable.length;
        setAction({ kind: "confirming", completed, total, documentId: single });
        for (const fact of confirmable) {
          await apiRequest<FactReviewResponse>(`${facts}/${encodeURIComponent(fact.id)}/review`, {
            method: "POST",
            headers: { "Idempotency-Key": crypto.randomUUID() },
            body: JSON.stringify({ factVersion: fact.factVersion, decision: "confirm" }),
          });
          completed += 1;
          setAction({ kind: "confirming", completed, total, documentId: single });
        }
      }
      setAction({ kind: "idle" });
    } catch {
      setAction({
        kind: "error",
        copy:
          completed === 0
            ? "Не удалось начать подтверждение. Ни одно значение не изменено."
            : `Подтверждено ${completed} из ${total}. Остальные значения не изменены; повторите действие.`,
      });
    }
    await input.reload();
  }

  async function restartDocuments(documents: readonly ProfileOverviewDocument[]): Promise<void> {
    const targets = documents.filter(isRestartable);
    if (targets.length === 0) return;
    const single = targets.length === 1 ? (targets[0]?.id ?? null) : null;
    setAction({ kind: "restarting", documentId: single });
    try {
      for (const document of targets) {
        await apiRequest<DocumentProcessingRestartResponse>(
          `${documentApiPath(input.familyId, input.profileId, document.id)}/processing/restart`,
          { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } },
        );
      }
      setAction({ kind: "idle" });
    } catch {
      setAction({
        kind: "error",
        copy: "Не удалось перезапустить разбор. Исходники не изменены; повторите действие.",
      });
    }
    await input.reload();
  }

  return { action, confirmDocuments, restartDocuments };
}
