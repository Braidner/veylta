"use client";

import type {
  DocumentAgentWorkspaceResponse,
  DocumentProcessingActivityEvent,
  DocumentProcessingRunDiagnostics,
} from "@veylta/contracts";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiPrefix, apiRequest } from "../api-client";
import { documentPath } from "../paths";
import { WorkspaceRequests } from "../workspace-requests";
import { DocumentAgentWorkspace } from "./document-agent-workspace";

function documentAgentPath(familyId: string, profileId: string, documentId: string): string {
  return `/v1${documentPath(familyId, profileId, documentId)}/agent`;
}

type DocumentAgentState =
  | { kind: "loading" }
  | { kind: "ready"; workspace: DocumentAgentWorkspaceResponse }
  | { kind: "error" };

/** A mutation keeps its idempotency key while the same input is retried, so a retry replays. */
interface Attempt {
  key: string;
  fingerprint: string;
}

interface DocumentAgentPanelProps {
  familyId: string;
  profileId: string;
  documentId: string;
  documentName: string;
  documentUploadedAt: string;
  workspaceRefreshKey: string;
  suggestedMessage: { id: string; prompt: string } | null;
  selectedRunId: string | null;
  activityRunId: string | null;
  activity: readonly DocumentProcessingActivityEvent[];
  diagnostics: DocumentProcessingRunDiagnostics | null;
  onSelectRun: (runId: string | null) => void;
}

/** The document dialogue's data side: loads the workspace, creates threads, sends messages. */
export function DocumentAgentPanel(props: DocumentAgentPanelProps) {
  const { familyId, profileId, documentId, workspaceRefreshKey, suggestedMessage } = props;
  const [state, setState] = useState<DocumentAgentState>({ kind: "loading" });
  const [isSwitching, setIsSwitching] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const attemptRef = useRef<Attempt | null>(null);
  const conversationAttemptRef = useRef<Attempt | null>(null);
  const workspaceRequests = useRef(new WorkspaceRequests());
  /**
   * The conversation the user means to see, updated synchronously on a selection or a
   * mutation. A background reload asks for this — never for the selection in `state`, which
   * may still be the previous one while a read is in flight.
   */
  const intendedConversation = useRef<string | null>(null);
  const loadedWorkspaceRefreshKey = useRef(workspaceRefreshKey);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const endpoint = documentAgentPath(familyId, profileId, documentId);

  const loadWorkspace = useCallback(
    async (conversationId?: string, signal?: AbortSignal): Promise<void> => {
      const isCurrent = workspaceRequests.current.claim();
      try {
        const query =
          conversationId === undefined
            ? ""
            : `?conversationId=${encodeURIComponent(conversationId)}`;
        const response = await apiRequest<DocumentAgentWorkspaceResponse>(
          `${endpoint}${query}`,
          signal === undefined ? undefined : { signal },
        );
        if (signal?.aborted || !isCurrent()) return;
        intendedConversation.current = response.selectedConversationId;
        setState({ kind: "ready", workspace: response });
      } catch {
        if (!signal?.aborted && isCurrent()) setState({ kind: "error" });
      }
    },
    [endpoint],
  );

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    setMessage("");
    setPendingMessage(null);
    setSendError(null);
    setCreateError(null);
    setIsSwitching(false);
    attemptRef.current = null;
    conversationAttemptRef.current = null;
    intendedConversation.current = null;
    void loadWorkspace(undefined, controller.signal);
    return () => controller.abort();
  }, [loadWorkspace]);

  // A processing update reloads the workspace, but never over a mutation in flight: the reload
  // would carry the selection from before the mutation and revert what the user just did. A
  // deferred reload runs when the mutation settles, with the selection the mutation returned.
  useEffect(() => {
    if (loadedWorkspaceRefreshKey.current === workspaceRefreshKey) return;
    loadedWorkspaceRefreshKey.current = workspaceRefreshKey;
    if (!workspaceRequests.current.requestRefresh()) return;
    void loadWorkspace(intendedConversation.current ?? undefined);
  }, [loadWorkspace, workspaceRefreshKey]);

  const settleMutation = useCallback(() => {
    const { refreshDeferred } = workspaceRequests.current.endMutation();
    if (refreshDeferred) void loadWorkspace(intendedConversation.current ?? undefined);
  }, [loadWorkspace]);

  useEffect(() => {
    if (suggestedMessage === null) return;
    setMessage(suggestedMessage.prompt);
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [suggestedMessage]);

  async function handleSelectConversation(conversationId: string): Promise<void> {
    if (
      isSwitching ||
      (state.kind === "ready" && state.workspace.selectedConversationId === conversationId)
    ) {
      return;
    }
    setIsSwitching(true);
    setSendError(null);
    setMessage("");
    intendedConversation.current = conversationId;
    await loadWorkspace(conversationId);
    setIsSwitching(false);
  }

  async function handleCreateConversation(title: string): Promise<boolean> {
    const previousAttempt = conversationAttemptRef.current;
    const attempt =
      previousAttempt?.fingerprint === title
        ? previousAttempt
        : { key: crypto.randomUUID(), fingerprint: title };
    conversationAttemptRef.current = attempt;
    setCreateError(null);
    const isCurrent = workspaceRequests.current.beginMutation();
    try {
      const response = await apiRequest<DocumentAgentWorkspaceResponse>(
        `${endpoint}/conversations`,
        {
          method: "POST",
          headers: { "Idempotency-Key": attempt.key },
          body: JSON.stringify({ title }),
        },
      );
      intendedConversation.current = response.selectedConversationId;
      if (isCurrent()) setState({ kind: "ready", workspace: response });
      setMessage("");
      conversationAttemptRef.current = null;
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) conversationAttemptRef.current = null;
      setCreateError(
        error instanceof ApiError && error.status === 409
          ? "Нельзя создать больше 20 диалогов для одного документа."
          : "Не удалось создать диалог. Проверьте соединение и повторите.",
      );
      return false;
    } finally {
      settleMutation();
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

    const previousAttempt = attemptRef.current;
    const attempt =
      previousAttempt?.fingerprint === normalized
        ? previousAttempt
        : { key: crypto.randomUUID(), fingerprint: normalized };
    attemptRef.current = attempt;
    setPendingMessage(normalized);
    setSendError(null);
    const isCurrent = workspaceRequests.current.beginMutation();
    try {
      const response = await apiRequest<DocumentAgentWorkspaceResponse>(
        `${endpoint}/conversations/${encodeURIComponent(state.workspace.selectedConversationId)}/messages`,
        {
          method: "POST",
          headers: { "Idempotency-Key": attempt.key },
          body: JSON.stringify({ message: normalized }),
        },
      );
      intendedConversation.current = response.selectedConversationId;
      if (isCurrent()) setState({ kind: "ready", workspace: response });
      setMessage("");
      attemptRef.current = null;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) attemptRef.current = null;
      setSendError(
        error instanceof ApiError && error.status === 503
          ? "Codex сейчас недоступен. Сообщение не потеряно — повторите отправку позже."
          : "Не удалось получить ответ Codex. Проверьте соединение и повторите отправку.",
      );
    } finally {
      setPendingMessage(null);
      settleMutation();
    }
  }

  return (
    <DocumentAgentWorkspace
      workspace={state.kind === "ready" ? state.workspace : null}
      documentName={props.documentName}
      documentUploadedAt={props.documentUploadedAt}
      documentContentHref={`${apiPrefix}/v1${documentPath(familyId, profileId, documentId)}/content`}
      isLoading={state.kind === "loading"}
      isSwitching={isSwitching}
      loadError={state.kind === "error"}
      message={message}
      pendingMessage={pendingMessage}
      sendError={sendError}
      createError={createError}
      selectedRunId={props.selectedRunId}
      activityRunId={props.activityRunId}
      activity={props.activity}
      diagnostics={props.diagnostics}
      composerRef={composerRef}
      onMessageChange={setMessage}
      onSelectRun={props.onSelectRun}
      onSelectConversation={(conversationId) => void handleSelectConversation(conversationId)}
      onCreateConversation={handleCreateConversation}
      onSend={(event) => void handleSend(event)}
    />
  );
}
