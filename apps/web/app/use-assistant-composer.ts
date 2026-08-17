"use client";

import type { AssistantSpecialty, AssistantWorkspaceResponse } from "@veylta/contracts";
import { type FormEvent, useRef, useState } from "react";
import { assistantConsiliumErrorCopy, assistantSendErrorCopy } from "./assistant";
import { conveneRequest, sendMessageRequest } from "./assistant-requests";

/** A mutation keeps its idempotency key while the same input is retried, so a retry replays. */
export interface Attempt {
  readonly key: string;
  readonly fingerprint: string;
}

export function attemptFor(current: Attempt | null, fingerprint: string): Attempt {
  return current?.fingerprint === fingerprint ? current : { key: crypto.randomUUID(), fingerprint };
}

/**
 * The composer's state and its two mutations: a message (to the therapist or, through a chip,
 * to one persona) and «Собрать консилиум», where the typed text becomes the panel's question.
 */
export function useAssistantComposer(input: {
  readonly endpoint: string;
  readonly conversationId: string | null;
  readonly mutate: <T>(operation: () => Promise<T>) => Promise<T>;
  readonly onWorkspace: (response: AssistantWorkspaceResponse) => void;
}) {
  const [message, setMessage] = useState("");
  const [addressee, setAddressee] = useState<AssistantSpecialty | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [consiliumPending, setConsiliumPending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const sendAttempt = useRef<Attempt | null>(null);
  const conveneAttempt = useRef<Attempt | null>(null);
  const busy = pendingMessage !== null || consiliumPending || input.conversationId === null;

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalized = message.trim();
    const conversationId = input.conversationId;
    if (normalized.length === 0 || normalized.length > 2_000 || busy || conversationId === null) {
      return;
    }
    const attempt = attemptFor(
      sendAttempt.current,
      `${conversationId}:${addressee ?? ""}:${normalized}`,
    );
    sendAttempt.current = attempt;
    setPendingMessage(normalized);
    setSendError(null);
    try {
      const response = await input.mutate(() =>
        sendMessageRequest(input.endpoint, conversationId, attempt.key, normalized, addressee),
      );
      sendAttempt.current = null;
      setMessage("");
      setAddressee(null);
      input.onWorkspace(response);
    } catch (error) {
      setSendError(assistantSendErrorCopy(error));
    } finally {
      setPendingMessage(null);
    }
  }

  async function convene(): Promise<void> {
    const conversationId = input.conversationId;
    if (busy || conversationId === null) return;
    const question = message.trim().length === 0 ? null : message.trim();
    const attempt = attemptFor(conveneAttempt.current, `${conversationId}:${question}`);
    conveneAttempt.current = attempt;
    setConsiliumPending(true);
    setSendError(null);
    try {
      const response = await input.mutate(() =>
        conveneRequest(input.endpoint, conversationId, attempt.key, question),
      );
      conveneAttempt.current = null;
      setMessage("");
      input.onWorkspace(response);
    } catch (error) {
      setSendError(assistantConsiliumErrorCopy(error));
    } finally {
      setConsiliumPending(false);
    }
  }

  function reset(): void {
    setSendError(null);
    setMessage("");
    setAddressee(null);
  }

  return {
    message,
    setMessage,
    addressee,
    setAddressee,
    pendingMessage,
    consiliumPending,
    sendError,
    fail: setSendError,
    send,
    convene,
    reset,
  };
}
