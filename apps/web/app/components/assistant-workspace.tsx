"use client";

import {
  ASSISTANT_EGRESS_ACKNOWLEDGEMENT,
  type AssistantEvidenceItem,
  type AssistantWorkspaceResponse,
} from "@veylta/contracts";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../api-client";
import { assistantCreateErrorCopy, assistantSendErrorCopy } from "../assistant";
import { assistantPath } from "../paths";
import { useReferralAcceptance } from "../use-referral-acceptance";
import { WorkspaceRequests } from "../workspace-requests";
import { AssistantPanel } from "./assistant-panel";

type WorkspaceState =
  | { kind: "loading" }
  | { kind: "ready"; workspace: AssistantWorkspaceResponse }
  | { kind: "error" };

interface Attempt {
  readonly key: string;
  readonly fingerprint: string;
}

interface AssistantWorkspaceProps {
  readonly familyId: string;
  readonly profileId: string;
  readonly assistantId: "physician";
  readonly requestedConversationId: string | undefined;
}

/**
 * The data side of the physician workspace: one endpoint, replay-safe mutations under
 * client-chosen idempotency keys, and the same request discipline as document dialogues.
 */
export function AssistantWorkspace({
  familyId,
  profileId,
  assistantId,
  requestedConversationId,
}: AssistantWorkspaceProps) {
  const router = useRouter();
  const [state, setState] = useState<WorkspaceState>({ kind: "loading" });
  const [isSwitching, setIsSwitching] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [acknowledgePending, setAcknowledgePending] = useState(false);
  const referrals = useReferralAcceptance(familyId, profileId);
  const sendAttempt = useRef<Attempt | null>(null);
  const createAttempt = useRef<Attempt | null>(null);
  const requests = useRef(new WorkspaceRequests());
  /** The conversation the panel shows or is about to show; the URL follows it, never leads. */
  const shownConversation = useRef<string | null | undefined>(undefined);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const endpoint = `/v1/families/${encodeURIComponent(familyId)}/profiles/${encodeURIComponent(profileId)}/assistants/${assistantId}`;

  const load = useCallback(
    async (conversationId: string | undefined, signal?: AbortSignal): Promise<void> => {
      const isCurrent = requests.current.claim();
      try {
        const query =
          conversationId === undefined
            ? ""
            : `?conversationId=${encodeURIComponent(conversationId)}`;
        const response = await apiRequest<AssistantWorkspaceResponse>(
          `${endpoint}${query}`,
          signal === undefined ? undefined : { signal },
        );
        if (signal?.aborted || !isCurrent()) return;
        shownConversation.current = response.selectedConversationId;
        setState({ kind: "ready", workspace: response });
      } catch {
        if (!signal?.aborted && isCurrent()) setState({ kind: "error" });
      }
    },
    [endpoint],
  );

  useEffect(() => {
    if (
      shownConversation.current !== undefined &&
      shownConversation.current === (requestedConversationId ?? null)
    ) {
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });
    void load(requestedConversationId, controller.signal);
    return () => controller.abort();
  }, [load, requestedConversationId]);

  const evidence = useMemo(() => {
    const index = new Map<string, AssistantEvidenceItem>();
    if (state.kind === "ready") {
      for (const item of state.workspace.evidence) index.set(item.observationId, item);
    }
    return index;
  }, [state]);

  function show(response: AssistantWorkspaceResponse): void {
    shownConversation.current = response.selectedConversationId;
    setState({ kind: "ready", workspace: response });
    router.replace(
      assistantPath(familyId, profileId, assistantId, response.selectedConversationId),
    );
  }

  async function mutate<T>(operation: () => Promise<T>): Promise<T> {
    requests.current.beginMutation();
    try {
      return await operation();
    } finally {
      requests.current.endMutation();
    }
  }

  async function handleSelectConversation(conversationId: string): Promise<void> {
    if (isSwitching) return;
    setIsSwitching(true);
    setSendError(null);
    setMessage("");
    shownConversation.current = conversationId;
    router.replace(assistantPath(familyId, profileId, assistantId, conversationId));
    await load(conversationId);
    setIsSwitching(false);
  }

  async function handleCreateConversation(title: string): Promise<boolean> {
    const attempt =
      createAttempt.current?.fingerprint === title
        ? createAttempt.current
        : { key: crypto.randomUUID(), fingerprint: title };
    createAttempt.current = attempt;
    setCreateError(null);
    try {
      const response = await mutate(() =>
        apiRequest<AssistantWorkspaceResponse>(`${endpoint}/conversations`, {
          method: "POST",
          headers: { "Idempotency-Key": attempt.key },
          body: JSON.stringify({ title }),
        }),
      );
      createAttempt.current = null;
      show(response);
      return true;
    } catch (error) {
      setCreateError(assistantCreateErrorCopy(error));
      return false;
    }
  }

  async function handleAcknowledge(): Promise<void> {
    if (state.kind !== "ready" || state.workspace.selectedConversationId === null) return;
    setAcknowledgePending(true);
    try {
      const response = await mutate(() =>
        apiRequest<AssistantWorkspaceResponse>(
          `${endpoint}/conversations/${encodeURIComponent(state.workspace.selectedConversationId ?? "")}/acknowledgement`,
          {
            method: "PUT",
            body: JSON.stringify({ acknowledgement: ASSISTANT_EGRESS_ACKNOWLEDGEMENT }),
          },
        ),
      );
      setState({ kind: "ready", workspace: response });
      composerRef.current?.focus();
    } catch (error) {
      setSendError(assistantSendErrorCopy(error));
    } finally {
      setAcknowledgePending(false);
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalized = message.trim();
    if (
      normalized.length === 0 ||
      normalized.length > 2_000 ||
      pendingMessage !== null ||
      state.kind !== "ready" ||
      state.workspace.selectedConversationId === null
    ) {
      return;
    }
    const conversationId = state.workspace.selectedConversationId;
    const fingerprint = `${conversationId}:${normalized}`;
    const attempt =
      sendAttempt.current?.fingerprint === fingerprint
        ? sendAttempt.current
        : { key: crypto.randomUUID(), fingerprint };
    sendAttempt.current = attempt;
    setPendingMessage(normalized);
    setSendError(null);
    try {
      const response = await mutate(() =>
        apiRequest<AssistantWorkspaceResponse>(
          `${endpoint}/conversations/${encodeURIComponent(conversationId)}/messages`,
          {
            method: "POST",
            headers: { "Idempotency-Key": attempt.key },
            body: JSON.stringify({ message: normalized }),
          },
        ),
      );
      sendAttempt.current = null;
      setMessage("");
      setState({ kind: "ready", workspace: response });
    } catch (error) {
      setSendError(assistantSendErrorCopy(error));
    } finally {
      setPendingMessage(null);
    }
  }

  return (
    <AssistantPanel
      familyId={familyId}
      profileId={profileId}
      workspace={state.kind === "ready" ? state.workspace : null}
      evidence={evidence}
      isLoading={state.kind === "loading"}
      isSwitching={isSwitching}
      loadError={state.kind === "error"}
      message={message}
      pendingMessage={pendingMessage}
      sendError={sendError}
      createError={createError}
      acknowledgePending={acknowledgePending}
      acceptedReferrals={referrals.accepted}
      pendingReferral={referrals.pending}
      referralError={referrals.error}
      composerRef={composerRef}
      onMessageChange={setMessage}
      onSelectConversation={(conversationId) => void handleSelectConversation(conversationId)}
      onCreateConversation={handleCreateConversation}
      onAcknowledge={() => void handleAcknowledge()}
      onAcceptReferral={(key, block) => void referrals.accept(key, block)}
      onSend={(event) => void handleSend(event)}
    />
  );
}
