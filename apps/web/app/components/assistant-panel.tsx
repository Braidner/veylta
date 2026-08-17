"use client";

import type {
  AssistantMessage,
  AssistantSpecialty,
  AssistantWorkspaceResponse,
} from "@veylta/contracts";
import { Bot, ShieldAlert } from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { assistantTitle, specialtyLabel } from "../assistant";
import { profileTabPath } from "../paths";
import { countCopy } from "../russian-plural";
import { AssistantAnswer } from "./assistant-answer";
import type { EvidenceIndex, ReferralBlock } from "./assistant-blocks";
import { AssistantComposer } from "./assistant-composer";
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
  readonly addressee: AssistantSpecialty | null;
  readonly pendingMessage: string | null;
  readonly consiliumPending: boolean;
  readonly sendError: string | null;
  readonly createError: string | null;
  readonly acknowledgePending: boolean;
  readonly acceptedReferrals: ReadonlySet<string>;
  readonly pendingReferral: string | null;
  readonly referralError: string | null;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onMessageChange: (message: string) => void;
  readonly onAddresseeChange: (addressee: AssistantSpecialty | null) => void;
  readonly onSelectConversation: (conversationId: string) => void;
  readonly onCreateConversation: (title: string) => Promise<boolean>;
  readonly onAcknowledge: () => void;
  readonly onAcceptReferral: (key: string, block: ReferralBlock) => void;
  readonly onSend: (event: FormEvent<HTMLFormElement>) => void;
  readonly onConvene: () => void;
}

/** The physician workspace: a rail of conversations, the egress gate, typed answers, a composer. */
export function AssistantPanel(props: AssistantPanelProps) {
  const { workspace, familyId, profileId } = props;
  const selected =
    workspace?.conversations.find((item) => item.id === workspace.selectedConversationId) ?? null;
  const canWrite = workspace?.canWrite ?? false;
  const gateOpen = selected !== null && !selected.acknowledged;
  const canSend =
    selected?.acknowledged === true &&
    canWrite &&
    !props.isLoading &&
    !props.isSwitching &&
    props.pendingMessage === null &&
    !props.consiliumPending;
  const canConvene = canSend && (workspace?.consiliumPanel.length ?? 0) > 0;

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
                  {props.addressee !== null ? (
                    <small>Вопрос: {specialtyLabel[props.addressee]}</small>
                  ) : null}
                  <p>{props.pendingMessage}</p>
                </article>
                <div className="document-agent-workspace__waiting" role="status">
                  <Bot size={17} strokeWidth={1.8} aria-hidden="true" />
                  <span>
                    {props.addressee === null
                      ? "ИИ-врач отвечает, затем второй запуск проверяет ответ…"
                      : `Отвечает специалист (${specialtyLabel[props.addressee]}), затем проверка…`}
                  </span>
                </div>
              </>
            ) : null}
            {props.consiliumPending ? (
              <div className="document-agent-workspace__waiting" role="status">
                <Bot size={17} strokeWidth={1.8} aria-hidden="true" />
                <span>
                  Консилиум работает: каждый специалист читает данные, затем ИИ-врач сводит мнения и
                  второй запуск проверяет синтез…
                </span>
              </div>
            ) : null}
            {props.referralError !== null ? (
              <p className="form-error" role="alert">
                {props.referralError}
              </p>
            ) : null}
          </div>

          <AssistantComposer
            message={props.message}
            addressee={props.addressee}
            canSend={canSend}
            canConvene={canConvene}
            consiliumPending={props.consiliumPending}
            panel={workspace?.consiliumPanel ?? []}
            evidence={props.evidence}
            hasConversation={selected !== null}
            sendError={props.sendError}
            composerRef={props.composerRef}
            onMessageChange={props.onMessageChange}
            onAddresseeChange={props.onAddresseeChange}
            onSend={props.onSend}
            onConvene={props.onConvene}
          />
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
        {item.addressee !== null ? <small>Вопрос: {specialtyLabel[item.addressee]}</small> : null}
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
