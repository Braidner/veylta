"use client";

import type { AssistantMessage, AssistantWorkspaceResponse } from "@veylta/contracts";
import { Bot, Send, ShieldAlert } from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { assistantTitle } from "../assistant";
import { profileTabPath } from "../paths";
import { countCopy } from "../russian-plural";
import { AssistantAnswer } from "./assistant-answer";
import type { EvidenceIndex, ReferralBlock } from "./assistant-blocks";
import { EgressGate } from "./assistant-gate";
import { AssistantRail } from "./assistant-rail";

interface AssistantPanelProps {
  readonly familyId: string;
  readonly profileId: string;
  readonly workspace: AssistantWorkspaceResponse | null;
  readonly evidence: EvidenceIndex;
  readonly isLoading: boolean;
  readonly isSwitching: boolean;
  readonly loadError: boolean;
  readonly message: string;
  readonly pendingMessage: string | null;
  readonly sendError: string | null;
  readonly createError: string | null;
  readonly acknowledgePending: boolean;
  readonly acceptedReferrals: ReadonlySet<string>;
  readonly pendingReferral: string | null;
  readonly referralError: string | null;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onMessageChange: (message: string) => void;
  readonly onSelectConversation: (conversationId: string) => void;
  readonly onCreateConversation: (title: string) => Promise<boolean>;
  readonly onAcknowledge: () => void;
  readonly onAcceptReferral: (key: string, block: ReferralBlock) => void;
  readonly onSend: (event: FormEvent<HTMLFormElement>) => void;
}

/** The physician workspace: a rail of conversations, the egress gate, typed answers, a composer. */
export function AssistantPanel(props: AssistantPanelProps) {
  const { workspace, familyId, profileId } = props;
  const selected =
    workspace?.conversations.find((item) => item.id === workspace.selectedConversationId) ?? null;
  const canWrite = workspace?.canWrite ?? false;
  const gateOpen = selected !== null && !selected.acknowledged;
  const canSend =
    selected?.acknowledged &&
    canWrite &&
    !props.isLoading &&
    !props.isSwitching &&
    props.pendingMessage === null;

  return (
    <section
      className="document-agent-workspace assistant-workspace"
      aria-label={assistantTitle}
      data-testid="assistant-workspace"
    >
      <div className="document-agent-workspace__shell assistant-workspace__shell">
        <AssistantRail
          workspace={workspace}
          canWrite={canWrite}
          isLoading={props.isLoading}
          isSwitching={props.isSwitching}
          createError={props.createError}
          onSelectConversation={props.onSelectConversation}
          onCreateConversation={props.onCreateConversation}
        />

        <div className="document-agent-workspace__chat">
          <header className="document-agent-workspace__chat-heading">
            <div>
              <span>{selected === null ? "Рабочая область" : "Диалог с ИИ-врачом"}</span>
              <h4>{selected?.title ?? "Выберите или создайте диалог"}</h4>
            </div>
            {workspace !== null ? (
              <span>
                {countCopy(workspace.evidenceCount, [
                  "подтверждённое значение",
                  "подтверждённых значения",
                  "подтверждённых значений",
                ])}
              </span>
            ) : null}
          </header>

          {workspace !== null && !workspace.interpretationReady ? (
            <div className="assistant-notice" role="status" data-testid="assistant-readiness">
              <ShieldAlert size={17} strokeWidth={1.8} aria-hidden="true" />
              <p>
                <strong>Интерпретации не будет:</strong> в медицинском профиле нет пола или года
                рождения.{" "}
                <a href={profileTabPath(familyId, profileId, "plan")}>Заполнить профиль</a>
              </p>
            </div>
          ) : null}

          <div
            className="document-agent-workspace__conversation"
            aria-live="polite"
            aria-busy={props.isLoading || props.isSwitching || props.pendingMessage !== null}
          >
            {props.loadError ? (
              <p className="document-agent-workspace__empty">
                Диалоги пока не открылись. Обновите страницу и попробуйте снова.
              </p>
            ) : null}
            {gateOpen && workspace !== null ? (
              <EgressGate
                workspace={workspace}
                canWrite={canWrite}
                pending={props.acknowledgePending}
                onAcknowledge={props.onAcknowledge}
              />
            ) : null}
            {!props.isSwitching && selected !== null && selected.acknowledged
              ? workspace?.messages.map((item) => (
                  <ConversationItem key={item.id} item={item} panel={props} />
                ))
              : null}
            {props.pendingMessage !== null ? (
              <>
                <article className="document-agent-workspace__message is-user is-pending">
                  <p>{props.pendingMessage}</p>
                </article>
                <div className="document-agent-workspace__waiting" role="status">
                  <Bot size={17} strokeWidth={1.8} aria-hidden="true" />
                  <span>ИИ-врач отвечает, затем второй запуск проверяет ответ…</span>
                </div>
              </>
            ) : null}
            {props.referralError !== null ? (
              <p className="form-error" role="alert">
                {props.referralError}
              </p>
            ) : null}
          </div>

          <form className="document-agent-workspace__composer" onSubmit={props.onSend}>
            <label htmlFor="assistant-message">Сообщение ИИ-врачу</label>
            <div className="document-agent-workspace__composer-row">
              <textarea
                ref={props.composerRef}
                id="assistant-message"
                value={props.message}
                maxLength={2_000}
                rows={3}
                placeholder={
                  selected === null
                    ? "Сначала создайте диалог"
                    : "Например: что означают мои последние анализы?"
                }
                onChange={(event) => props.onMessageChange(event.target.value)}
                disabled={!canSend}
              />
              <button
                className="button button--primary document-agent-workspace__send"
                type="submit"
                disabled={!canSend || props.message.trim().length === 0}
              >
                <span>Отправить</span>
                <Send size={17} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
            <div className="document-agent-workspace__composer-meta">
              <span>{props.message.length} / 2000</span>
              <span>Каждый вывод — рекомендация для подтверждения у врача.</span>
            </div>
            {props.sendError !== null ? (
              <p className="form-error" role="alert">
                {props.sendError}
              </p>
            ) : null}
          </form>
        </div>
      </div>
    </section>
  );
}

function ConversationItem({
  item,
  panel,
}: {
  readonly item: AssistantMessage;
  readonly panel: AssistantPanelProps;
}) {
  if (item.role === "user") {
    return (
      <article className="document-agent-workspace__message is-user">
        <p>{item.text}</p>
      </article>
    );
  }
  return (
    <AssistantAnswer
      message={item}
      familyId={panel.familyId}
      profileId={panel.profileId}
      evidence={panel.evidence}
      canWrite={panel.workspace?.canWrite ?? false}
      acceptedReferrals={panel.acceptedReferrals}
      pendingReferral={panel.pendingReferral}
      onAcceptReferral={panel.onAcceptReferral}
    />
  );
}
