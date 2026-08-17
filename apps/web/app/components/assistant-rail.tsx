"use client";

import type { AssistantWorkspaceResponse } from "@veylta/contracts";
import { Plus, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { formatDate } from "../format-moment";
import { countCopy } from "../russian-plural";

interface AssistantRailProps {
  readonly workspace: AssistantWorkspaceResponse | null;
  readonly canWrite: boolean;
  readonly isLoading: boolean;
  readonly isSwitching: boolean;
  readonly createError: string | null;
  readonly onSelectConversation: (conversationId: string) => void;
  readonly onCreateConversation: (title: string) => Promise<boolean>;
}

/** The rail of the physician's conversations, newest first, with the create form. */
export function AssistantRail({
  workspace,
  canWrite,
  isLoading,
  isSwitching,
  createError,
  onSelectConversation,
  onCreateConversation,
}: AssistantRailProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const titleInputId = useId();

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalized = newTitle.trim();
    if (normalized.length === 0 || normalized.length > 80 || isSavingTitle) return;
    setIsSavingTitle(true);
    const created = await onCreateConversation(normalized);
    setIsSavingTitle(false);
    if (created) {
      setNewTitle("");
      setIsCreating(false);
    }
  }

  return (
    <aside className="document-agent-workspace__rail" aria-label="Диалоги с ИИ-врачом">
      <div className="document-agent-workspace__rail-section">
        <div className="document-agent-workspace__rail-heading">
          <div>
            <strong>Диалоги</strong>
            <span>{workspace?.conversations.length ?? 0}</span>
          </div>
          {canWrite ? (
            <button
              className="document-agent-workspace__icon-button"
              type="button"
              aria-label="Создать диалог"
              aria-expanded={isCreating}
              onClick={() => setIsCreating((current) => !current)}
              disabled={isLoading}
            >
              {isCreating ? <X size={16} /> : <Plus size={17} />}
            </button>
          ) : null}
        </div>
        {isCreating ? (
          <form className="document-agent-workspace__new-thread" onSubmit={handleCreate}>
            <label htmlFor={titleInputId}>Название диалога</label>
            <input
              id={titleInputId}
              value={newTitle}
              maxLength={80}
              placeholder="Например, разбор анализов за август"
              onChange={(event) => setNewTitle(event.target.value)}
              disabled={isSavingTitle}
            />
            <button
              className="button button--primary"
              type="submit"
              disabled={newTitle.trim().length === 0 || isSavingTitle}
            >
              {isSavingTitle ? "Создаём…" : "Создать"}
            </button>
            {createError !== null ? (
              <p className="form-error" role="alert">
                {createError}
              </p>
            ) : null}
          </form>
        ) : null}
        <div className="document-agent-workspace__thread-list">
          {!isLoading && workspace?.conversations.length === 0 ? (
            <p className="document-agent-workspace__rail-empty">
              {canWrite
                ? "Создайте диалог — например, «Разбор анализов за август»."
                : "Диалогов пока нет."}
            </p>
          ) : null}
          {workspace?.conversations.map((conversation) => {
            const isSelected = conversation.id === workspace.selectedConversationId;
            return (
              <button
                type="button"
                className={`document-agent-workspace__thread${isSelected ? " is-selected" : ""}`}
                key={conversation.id}
                aria-current={isSelected ? "page" : undefined}
                onClick={() => onSelectConversation(conversation.id)}
                disabled={isSwitching}
              >
                <span className="document-agent-workspace__thread-title">
                  <strong>{conversation.title}</strong>
                  <time dateTime={conversation.lastMessageAt ?? conversation.updatedAt}>
                    {formatDate(conversation.lastMessageAt ?? conversation.updatedAt)}
                  </time>
                </span>
                <span>
                  {countCopy(conversation.messageCount, ["сообщение", "сообщения", "сообщений"])}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
