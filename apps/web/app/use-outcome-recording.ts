"use client";

import type { AssistantOutcomeRequest, AssistantWorkspaceResponse } from "@veylta/contracts";
import { useState } from "react";
import { recordOutcomeRequest } from "./assistant-requests";

/**
 * Recording the clinician's word on a block goes through the room's own endpoint and comes back
 * as the whole workspace, so the answer and the rail's log refresh together.
 */
export function useOutcomeRecording(input: {
  readonly endpoint: string;
  readonly conversationId: string | null;
  readonly mutate: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly onWorkspace: (response: AssistantWorkspaceResponse) => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function record(
    messageId: string,
    blockIndex: number,
    request: AssistantOutcomeRequest,
  ): Promise<boolean> {
    if (input.conversationId === null || pending !== null) return false;
    const key = `${messageId}:${blockIndex}`;
    const conversationId = input.conversationId;
    setPending(key);
    setError(null);
    try {
      input.onWorkspace(
        await input.mutate(() =>
          recordOutcomeRequest(input.endpoint, conversationId, messageId, blockIndex, request),
        ),
      );
      return true;
    } catch {
      setError("Не удалось сохранить слово врача. Повторите попытку.");
      return false;
    } finally {
      setPending(null);
    }
  }

  return { pending, error, record };
}
