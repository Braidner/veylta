"use client";

import type { DocumentAgentMessage, DocumentAgentWorkspaceResponse } from "@veylta/contracts";
import {
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  MessageCircle,
  Plus,
  Send,
  X,
} from "lucide-react";
import { type FormEvent, type RefObject, useId, useMemo, useState } from "react";
import {
  documentAgentConversationPreview,
  documentAgentRunPresentation,
} from "../document-agent-workspace";

interface DocumentAgentWorkspaceProps {
  readonly workspace: DocumentAgentWorkspaceResponse | null;
  readonly documentName: string;
  readonly documentUploadedAt: string;
  readonly documentContentHref: string;
  readonly isLoading: boolean;
  readonly isSwitching: boolean;
  readonly loadError: boolean;
  readonly message: string;
  readonly pendingMessage: string | null;
  readonly sendError: string | null;
  readonly createError: string | null;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onMessageChange: (message: string) => void;
  readonly onSelectConversation: (conversationId: string) => void;
  readonly onCreateConversation: (title: string) => Promise<boolean>;
  readonly onSend: (event: FormEvent<HTMLFormElement>) => void;
}

export function DocumentAgentWorkspace({
  workspace,
  documentName,
  documentUploadedAt,
  documentContentHref,
  isLoading,
  isSwitching,
  loadError,
  message,
  pendingMessage,
  sendError,
  createError,
  composerRef,
  onMessageChange,
  onSelectConversation,
  onCreateConversation,
  onSend,
}: DocumentAgentWorkspaceProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const titleInputId = useId();
  const selectedConversation = useMemo(
    () =>
      workspace?.conversations.find(
        (conversation) => conversation.id === workspace.selectedConversationId,
      ) ?? null,
    [workspace],
  );

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

  const messages = workspace?.messages ?? [];
  const canSend =
    workspace?.selectedConversationId !== null &&
    workspace !== null &&
    !isLoading &&
    !isSwitching &&
    pendingMessage === null;

  return (
    <section className="document-agent-workspace" aria-labelledby="document-agent-title">
      <header className="document-agent-workspace__intro">
        <span className="document-agent-workspace__intro-icon" aria-hidden="true">
          <MessageCircle size={20} strokeWidth={1.8} />
        </span>
        <div>
          <p className="context-line">Контекст этого источника</p>
          <h3 id="document-agent-title">Диалог с Codex</h3>
          <p>
            Сохраняйте отдельные обсуждения по документу и отличайте их от разовых запусков
            обработки.
          </p>
        </div>
      </header>

      <div className="document-agent-workspace__shell">
        <aside className="document-agent-workspace__rail" aria-label="Документ и диалоги">
          <div className="document-agent-workspace__document">
            <span className="document-agent-workspace__file-icon" aria-hidden="true">
              <FileText size={19} strokeWidth={1.8} />
            </span>
            <div>
              <strong title={documentName}>{documentName}</strong>
              <span>Загружен {formatAgentDate(documentUploadedAt)}</span>
            </div>
            <a
              href={documentContentHref}
              target="_blank"
              rel="noreferrer"
              aria-label={`Открыть исходный документ ${documentName}`}
            >
              <ExternalLink size={16} strokeWidth={1.8} aria-hidden="true" />
            </a>
          </div>

          <div className="document-agent-workspace__rail-section">
            <div className="document-agent-workspace__rail-heading">
              <div>
                <strong>Диалоги</strong>
                <span>{workspace?.conversations.length ?? 0}</span>
              </div>
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
            </div>

            {isCreating ? (
              <form className="document-agent-workspace__new-thread" onSubmit={handleCreate}>
                <label htmlFor={titleInputId}>Название диалога</label>
                <input
                  id={titleInputId}
                  value={newTitle}
                  maxLength={80}
                  placeholder="Например, разбор показателей"
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
              {isLoading ? <RailLoading /> : null}
              {!isLoading && workspace?.conversations.length === 0 ? (
                <p className="document-agent-workspace__rail-empty">
                  Создайте диалог для отдельной темы или проверки.
                </p>
              ) : null}
              {workspace?.conversations.map((conversation) => {
                const selected = conversation.id === workspace.selectedConversationId;
                return (
                  <button
                    type="button"
                    className={`document-agent-workspace__thread${selected ? " is-selected" : ""}`}
                    key={conversation.id}
                    aria-current={selected ? "page" : undefined}
                    onClick={() => onSelectConversation(conversation.id)}
                    disabled={isSwitching}
                  >
                    <span className="document-agent-workspace__thread-title">
                      <strong>{conversation.title}</strong>
                      <time dateTime={conversation.lastMessageAt ?? conversation.updatedAt}>
                        {formatAgentRelativeDate(
                          conversation.lastMessageAt ?? conversation.updatedAt,
                        )}
                      </time>
                    </span>
                    <span>{documentAgentConversationPreview(conversation)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="document-agent-workspace__rail-section document-agent-workspace__runs">
            <div className="document-agent-workspace__rail-heading">
              <div>
                <strong>Запуски Codex</strong>
                <span>{workspace?.runs.length ?? 0}</span>
              </div>
              <a href="#processing-activity-title">Вся активность</a>
            </div>
            {workspace?.runs.length === 0 && !isLoading ? (
              <p className="document-agent-workspace__rail-empty">
                Запусков по документу пока нет.
              </p>
            ) : null}
            <ol>
              {workspace?.runs.map((run) => {
                const presentation = documentAgentRunPresentation(run);
                return (
                  <li key={run.id}>
                    <span
                      className={`document-agent-workspace__run-mark is-${presentation.tone}`}
                      aria-hidden="true"
                    >
                      {presentation.tone === "complete" ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <Clock3 size={16} />
                      )}
                    </span>
                    <div>
                      <strong>{run.title}</strong>
                      <span>{presentation.label}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>

        <div className="document-agent-workspace__chat">
          <header className="document-agent-workspace__chat-heading">
            <div>
              <span>
                {selectedConversation === null ? "Рабочая область" : "Диалог по документу"}
              </span>
              <h4>{selectedConversation?.title ?? "Выберите или создайте диалог"}</h4>
            </div>
            {selectedConversation !== null ? (
              <span>{formatMessageCount(selectedConversation.messageCount)}</span>
            ) : null}
          </header>

          <div className="document-agent-workspace__privacy-note">
            <Bot size={17} strokeWidth={1.8} aria-hidden="true" />
            <p>
              <strong>Только контекст этого документа.</strong> Исходный файл остаётся в Veylta;
              Codex ничего не подтверждает и не меняет автоматически.
            </p>
          </div>

          <div
            className="document-agent-workspace__conversation"
            aria-live="polite"
            aria-busy={isLoading || isSwitching || pendingMessage !== null}
          >
            {isLoading || isSwitching ? <ConversationLoading /> : null}
            {loadError ? (
              <ConversationEmpty
                title="Диалоги пока не открылись"
                copy="Документ не изменён. Обновите страницу и попробуйте снова."
              />
            ) : null}
            {!isLoading && !loadError && workspace?.selectedConversationId === null ? (
              <ConversationEmpty
                title="Начните с отдельной темы"
                copy="Создайте диалог слева — например, для разбора результатов или проверки даты исследования."
              />
            ) : null}
            {!isLoading && !loadError && selectedConversation !== null && messages.length === 0 ? (
              <ConversationEmpty
                title="Задайте первый конкретный вопрос"
                copy="Например: «Каких полей не хватает?» или «Проверь ещё раз дату биоматериала»."
              />
            ) : null}
            {!isSwitching
              ? messages.map((item) => <AgentMessage key={item.id} message={item} />)
              : null}
            {pendingMessage !== null ? (
              <>
                <article className="document-agent-workspace__message is-user is-pending">
                  <MessageMeta name="Вы" label="Отправляется" />
                  <p>{pendingMessage}</p>
                </article>
                <div className="document-agent-workspace__waiting" role="status">
                  <Bot size={17} strokeWidth={1.8} aria-hidden="true" />
                  <span>Codex проверяет структуру ответа…</span>
                </div>
              </>
            ) : null}
          </div>

          <form className="document-agent-workspace__composer" onSubmit={onSend}>
            <label htmlFor="document-agent-message">Сообщение для Codex</label>
            <div className="document-agent-workspace__composer-row">
              <textarea
                ref={composerRef}
                id="document-agent-message"
                value={message}
                maxLength={2_000}
                rows={3}
                placeholder={
                  selectedConversation === null
                    ? "Сначала создайте диалог"
                    : "Например: проверь ещё раз лабораторию и дату биоматериала"
                }
                onChange={(event) => onMessageChange(event.target.value)}
                disabled={!canSend}
              />
              <button
                className="button button--primary document-agent-workspace__send"
                type="submit"
                disabled={!canSend || message.trim().length === 0}
              >
                <span>Отправить</span>
                <Send size={17} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="document-agent-workspace__composer-meta">
              <span>{message.length} / 2000</span>
              <span>Диалог сохраняется в Veylta; запуск обработки — нет.</span>
            </div>
            {sendError !== null ? (
              <p className="form-error" role="alert">
                {sendError}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </section>
  );
}

function AgentMessage({ message }: { readonly message: DocumentAgentMessage }) {
  const assistant = message.role === "assistant";
  return (
    <article
      className={`document-agent-workspace__message ${assistant ? "is-assistant" : "is-user"}`}
    >
      <MessageMeta
        name={assistant ? "Codex" : "Вы"}
        label={formatAgentTime(message.createdAt)}
        dateTime={message.createdAt}
      />
      <p>{message.text}</p>
      {message.provenance !== null ? <small>{message.provenance.modelId}</small> : null}
    </article>
  );
}

function MessageMeta({
  name,
  label,
  dateTime,
}: {
  readonly name: string;
  readonly label: string;
  readonly dateTime?: string;
}) {
  return (
    <div className="document-agent-workspace__message-meta">
      <strong>{name}</strong>
      {dateTime === undefined ? <span>{label}</span> : <time dateTime={dateTime}>{label}</time>}
    </div>
  );
}

function ConversationEmpty({ title, copy }: { readonly title: string; readonly copy: string }) {
  return (
    <div className="document-agent-workspace__empty">
      <MessageCircle size={24} strokeWidth={1.6} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

function RailLoading() {
  return (
    <div className="document-agent-workspace__rail-loading" role="status">
      <span />
      <span className="is-delay-one" />
      <span className="is-delay-two" />
      <span className="sr-only">Загружаем диалоги</span>
    </div>
  );
}

function ConversationLoading() {
  return (
    <div className="document-agent-workspace__loading" role="status">
      <span />
      <span className="is-delay-one" />
      <span className="is-delay-two" />
      <span className="sr-only">Загружаем диалог</span>
    </div>
  );
}

function formatAgentDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(value))
    .replace(" г.", "");
}

function formatAgentRelativeDate(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatAgentTime(value);
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date);
}

function formatAgentTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function formatMessageCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const noun =
    mod10 === 1 && mod100 !== 11
      ? "сообщение"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "сообщения"
        : "сообщений";
  return `${count} ${noun}`;
}
