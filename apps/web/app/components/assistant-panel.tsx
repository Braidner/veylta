"use client";

import type {
  AssistantId,
  AssistantMessage,
  AssistantOutcomeRequest,
  AssistantWorkspaceResponse,
} from "@veylta/contracts";
import { ContactRound, ShieldAlert } from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { assistantIdentity, specialtyLabel } from "../assistant";
import { profileTabPath } from "../paths";
import { countCopy } from "../russian-plural";
import type { Recipient } from "../use-assistant-composer";
import { AssistantAnswer } from "./assistant-answer";
import type { EvidenceIndex, RecordIndex, ReferralBlock } from "./assistant-blocks";
import { AssistantComposer } from "./assistant-composer";
import { EgressGate } from "./assistant-gate";
import { Openers, UserMessage, Waiting } from "./assistant-messages";
import { AssistantRail } from "./assistant-rail";

interface AssistantPanelProps {
  readonly assistantId: AssistantId;
  readonly familyId: string;
  readonly profileId: string;
  readonly workspace: AssistantWorkspaceResponse | null;
  readonly evidence: EvidenceIndex;
  readonly records: RecordIndex;
  readonly isLoading: boolean;
  readonly isSwitching: boolean;
  readonly loadError: boolean;
  readonly message: string;
  readonly recipient: Recipient;
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
  readonly onRecipientChange: (recipient: Recipient) => void;
  readonly onSelectConversation: (conversationId: string) => void;
  readonly onCreateConversation: (title: string) => Promise<boolean>;
  readonly onAcknowledge: () => void;
  readonly onAcceptReferral: (key: string, block: ReferralBlock) => void;
  readonly pendingOutcome: string | null;
  readonly outcomeError: string | null;
  readonly onRecordOutcome: (
    messageId: string,
    blockIndex: number,
    request: AssistantOutcomeRequest,
  ) => Promise<boolean>;
  readonly onSend: (event: FormEvent<HTMLFormElement>) => void;
}

/** One assistant's room: a rail of conversations, the stream with the egress gate, a composer. */
export function AssistantPanel(props: AssistantPanelProps) {
  const { workspace, familyId, profileId, assistantId } = props;
  const identity = assistantIdentity[assistantId];
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
  const empty =
    !props.isSwitching &&
    selected !== null &&
    selected.acknowledged &&
    workspace !== null &&
    workspace.messages.length === 0 &&
    props.pendingMessage === null &&
    !props.consiliumPending;

  return (
    <section
      className="assistant-workspace"
      aria-label={identity.title}
      data-testid="assistant-workspace"
    >
      <div className="assistant-shell">
        <AssistantRail
          label={`Диалоги с ${identity.instrumental}`}
          assistantId={assistantId}
          workspace={workspace}
          canWrite={canWrite}
          isLoading={props.isLoading}
          isSwitching={props.isSwitching}
          createError={props.createError}
          onSelectConversation={props.onSelectConversation}
          onCreateConversation={props.onCreateConversation}
        />
        <div className="assistant-chat">
          <header className="assistant-chat__head">
            <div>
              {selected?.purpose !== null && selected?.purpose !== undefined ? (
                <span className="assistant-chat__purpose">
                  <ContactRound size={13} aria-hidden="true" />
                  из досье
                </span>
              ) : null}
              <h2>{selected?.title ?? "Выберите или создайте диалог"}</h2>
            </div>
            {workspace !== null ? (
              <span className="assistant-chat__evidence">
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
                <a href={profileTabPath(familyId, profileId, "dossier")}>Заполнить досье</a>
              </p>
            </div>
          ) : null}

          <div
            className="assistant-chat__stream"
            aria-live="polite"
            aria-busy={props.isLoading || props.isSwitching || props.pendingMessage !== null}
          >
            {props.loadError ? (
              <p className="assistant-chat__empty">
                Диалоги пока не открылись. Обновите страницу и попробуйте снова.
              </p>
            ) : null}
            {!props.isLoading && selected === null && !props.loadError ? (
              <p className="assistant-chat__empty">
                {canWrite
                  ? "Выберите диалог слева или создайте новый — например, «Разбор анализов за август». Из досье сюда ведут вопросы к нужному специалисту."
                  : "Диалогов пока нет."}
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
            {empty && canWrite ? (
              <Openers assistantId={assistantId} onPick={props.onMessageChange} />
            ) : null}
            {!props.isSwitching && selected !== null && selected.acknowledged
              ? workspace?.messages.map((item) => (
                  <ConversationItem key={item.id} item={item} panel={props} />
                ))
              : null}
            {props.pendingMessage !== null ? (
              <>
                <UserMessage
                  text={props.pendingMessage}
                  addressee={props.recipient === "consilium" ? null : props.recipient}
                  pending
                />
                <Waiting>
                  {props.recipient === null || props.recipient === "consilium"
                    ? `${identity.name} отвечает, затем второй запуск проверяет ответ…`
                    : `Отвечает специалист (${specialtyLabel[props.recipient]}), затем проверка…`}
                </Waiting>
              </>
            ) : null}
            {props.consiliumPending ? (
              <Waiting>
                Консилиум работает: каждый специалист читает данные, затем ИИ-врач сводит мнения и
                второй запуск проверяет синтез…
              </Waiting>
            ) : null}
            {props.referralError !== null || props.outcomeError !== null ? (
              <p className="form-error" role="alert">
                {props.referralError ?? props.outcomeError}
              </p>
            ) : null}
          </div>

          <div className="assistant-chat__composer">
            <AssistantComposer
              assistantId={assistantId}
              message={props.message}
              recipient={props.recipient}
              canSend={canSend}
              canConvene={canConvene}
              consiliumPending={props.consiliumPending}
              panel={workspace?.consiliumPanel ?? []}
              evidence={props.evidence}
              hasConversation={selected !== null}
              sendError={props.sendError}
              composerRef={props.composerRef}
              onMessageChange={props.onMessageChange}
              onRecipientChange={props.onRecipientChange}
              onSend={props.onSend}
            />
          </div>
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
  if (item.role === "user") return <UserMessage text={item.text} addressee={item.addressee} />;
  return (
    <AssistantAnswer
      message={item}
      assistantId={panel.assistantId}
      familyId={panel.familyId}
      profileId={panel.profileId}
      evidence={panel.evidence}
      records={panel.records}
      canWrite={panel.workspace?.canWrite ?? false}
      acceptedReferrals={panel.acceptedReferrals}
      pendingReferral={panel.pendingReferral}
      onAcceptReferral={panel.onAcceptReferral}
      pendingOutcome={panel.pendingOutcome}
      onRecordOutcome={panel.onRecordOutcome}
    />
  );
}
