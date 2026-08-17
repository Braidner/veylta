"use client";

import type { AssistantEvidenceItem, AssistantWorkspaceResponse } from "@veylta/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assistantCreateErrorCopy, assistantSendErrorCopy } from "../assistant";
import {
  acknowledgeRequest,
  assistantEndpoint,
  createConversationRequest,
  loadWorkspaceRequest,
} from "../assistant-requests";
import { assistantPath } from "../paths";
import { type Attempt, attemptFor, useAssistantComposer } from "../use-assistant-composer";
import { useReferralAcceptance } from "../use-referral-acceptance";
import { WorkspaceRequests } from "../workspace-requests";
import { AssistantPanel } from "./assistant-panel";

type WorkspaceState =
  | { kind: "loading" }
  | { kind: "ready"; workspace: AssistantWorkspaceResponse }
  | { kind: "error" };

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
  const [createError, setCreateError] = useState<string | null>(null);
  const [acknowledgePending, setAcknowledgePending] = useState(false);
  const referrals = useReferralAcceptance(familyId, profileId);
  const createAttempt = useRef<Attempt | null>(null);
  const requests = useRef(new WorkspaceRequests());
  /** The conversation the panel shows or is about to show; the URL follows it, never leads. */
  const shownConversation = useRef<string | null | undefined>(undefined);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const endpoint = assistantEndpoint(familyId, profileId, assistantId);

  const load = useCallback(
    async (conversationId: string | undefined, signal?: AbortSignal): Promise<void> => {
      const isCurrent = requests.current.claim();
      try {
        const response = await loadWorkspaceRequest(endpoint, conversationId, signal);
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

  const selectedConversationId =
    state.kind === "ready" ? state.workspace.selectedConversationId : null;

  async function handleSelectConversation(conversationId: string): Promise<void> {
    if (isSwitching) return;
    setIsSwitching(true);
    composer.reset();
    shownConversation.current = conversationId;
    router.replace(assistantPath(familyId, profileId, assistantId, conversationId));
    await load(conversationId);
    setIsSwitching(false);
  }

  async function handleCreateConversation(title: string): Promise<boolean> {
    const attempt = attemptFor(createAttempt.current, title);
    createAttempt.current = attempt;
    setCreateError(null);
    try {
      show(await mutate(() => createConversationRequest(endpoint, attempt.key, title)));
      createAttempt.current = null;
      return true;
    } catch (error) {
      setCreateError(assistantCreateErrorCopy(error));
      return false;
    }
  }

  async function handleAcknowledge(): Promise<void> {
    if (selectedConversationId === null) return;
    setAcknowledgePending(true);
    try {
      const response = await mutate(() => acknowledgeRequest(endpoint, selectedConversationId));
      setState({ kind: "ready", workspace: response });
      composerRef.current?.focus();
    } catch (error) {
      composer.fail(assistantSendErrorCopy(error));
    } finally {
      setAcknowledgePending(false);
    }
  }

  const composer = useAssistantComposer({
    endpoint,
    conversationId: selectedConversationId,
    mutate,
    onWorkspace: (response) => setState({ kind: "ready", workspace: response }),
  });

  return (
    <AssistantPanel
      familyId={familyId}
      profileId={profileId}
      workspace={state.kind === "ready" ? state.workspace : null}
      evidence={evidence}
      isLoading={state.kind === "loading"}
      isSwitching={isSwitching}
      loadError={state.kind === "error"}
      message={composer.message}
      addressee={composer.addressee}
      pendingMessage={composer.pendingMessage}
      consiliumPending={composer.consiliumPending}
      sendError={composer.sendError}
      createError={createError}
      acknowledgePending={acknowledgePending}
      acceptedReferrals={referrals.accepted}
      pendingReferral={referrals.pending}
      referralError={referrals.error}
      composerRef={composerRef}
      onMessageChange={composer.setMessage}
      onAddresseeChange={composer.setAddressee}
      onSelectConversation={(conversationId) => void handleSelectConversation(conversationId)}
      onCreateConversation={handleCreateConversation}
      onAcknowledge={() => void handleAcknowledge()}
      onAcceptReferral={(key, block) => void referrals.accept(key, block)}
      onSend={(event) => void composer.send(event)}
      onConvene={() => void composer.convene()}
    />
  );
}
