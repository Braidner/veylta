"use client";

import type { AssistantWorkspaceResponse } from "@veylta/contracts";
import { ContactRound, Plus, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { formatShortMoment } from "../format-moment";
import { countCopy } from "../russian-plural";

interface AssistantRailProps {
  /** The rail's accessible name — «Диалоги с ИИ-врачом», «Диалоги с ИИ-нутрициологом». */
  readonly label: string;
  readonly workspace: AssistantWorkspaceResponse | null;
  readonly canWrite: boolean;
  readonly isLoading: boolean;
  readonly isSwitching: boolean;
  readonly createError: string | null;
  readonly onSelectConversation: (conversationId: string) => void;
  readonly onCreateConversation: (title: string) => Promise<boolean>;
}

/** The rail of one assistant's conversations, newest first, with the create form. */
export function AssistantRail({
  label,
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
    <aside className="assistant-rail" aria-label={label}>
      <div className="assistant-rail__heading">
        <strong>Диалоги</strong>
        <span className="assistant-rail__count">{workspace?.conversations.length ?? 0}</span>
        {canWrite ? (
          <button
            className="assistant-rail__new"
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
        <form className="assistant-rail__form" onSubmit={handleCreate}>
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
      <ul className="assistant-rail__list">
        {!isLoading && workspace?.conversations.length === 0 ? (
          <li className="assistant-rail__empty">
            {canWrite
              ? "Создайте диалог — например, «Разбор анализов за август»."
              : "Диалогов пока нет."}
          </li>
        ) : null}
        {workspace?.conversations.map((conversation) => {
          const isSelected = conversation.id === workspace.selectedConversationId;
          const at = conversation.lastMessageAt ?? conversation.updatedAt;
          return (
            <li key={conversation.id}>
              <button
                type="button"
                className={`assistant-rail__item${isSelected ? " is-selected" : ""}`}
                aria-current={isSelected ? "page" : undefined}
                onClick={() => onSelectConversation(conversation.id)}
                disabled={isSwitching}
              >
                <strong>
                  {conversation.purpose !== null ? (
                    <ContactRound size={13} aria-hidden="true" />
                  ) : null}
                  {conversation.title}
                </strong>
                <span>
                  <time dateTime={at}>{formatShortMoment(at)}</time>
                  {" · "}
                  {countCopy(conversation.messageCount, ["сообщение", "сообщения", "сообщений"])}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
