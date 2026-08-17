"use client";

import type { AssistantInvitation, AssistantSpecialty } from "@veylta/contracts";
import { Send, Users, X } from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { invitationCopy, specialtyLabel } from "../assistant";
import type { EvidenceIndex } from "./assistant-blocks";

interface AssistantComposerProps {
  readonly message: string;
  readonly addressee: AssistantSpecialty | null;
  readonly canSend: boolean;
  readonly canConvene: boolean;
  readonly consiliumPending: boolean;
  readonly panel: readonly AssistantInvitation[];
  readonly evidence: EvidenceIndex;
  readonly hasConversation: boolean;
  readonly sendError: string | null;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onMessageChange: (message: string) => void;
  readonly onAddresseeChange: (addressee: AssistantSpecialty | null) => void;
  readonly onSend: (event: FormEvent<HTMLFormElement>) => void;
  readonly onConvene: () => void;
}

/**
 * The composer: a message to the therapist, or — through a chip — to one persona of the
 * консилиум; and «Собрать консилиум», which convenes the panel the evidence names (the typed
 * text, if any, becomes the question every specialist and the synthesis answer).
 */
export function AssistantComposer(props: AssistantComposerProps) {
  const { panel, addressee } = props;
  return (
    <form className="document-agent-workspace__composer assistant-composer" onSubmit={props.onSend}>
      {panel.length > 0 && props.hasConversation ? (
        <div className="assistant-composer__panel" data-testid="assistant-consilium-panel">
          <span className="assistant-composer__panel-title">
            <Users size={15} aria-hidden="true" />
            Консилиум по вашим данным:
          </span>
          <ul className="assistant-composer__chips" aria-label="Спросить специалиста">
            {panel.map((invitation) => {
              const active = addressee === invitation.specialty;
              return (
                <li key={invitation.specialty}>
                  <button
                    type="button"
                    className={`assistant-chip${active ? " is-active" : ""}`}
                    aria-pressed={active}
                    title={invitationCopy(invitation, props.evidence)}
                    onClick={() => props.onAddresseeChange(active ? null : invitation.specialty)}
                    disabled={!props.canSend}
                  >
                    {active ? "Спрашиваем: " : "Спросить: "}
                    {specialtyLabel[invitation.specialty]}
                    <small> · {invitationCopy(invitation, props.evidence)}</small>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <label htmlFor="assistant-message">
        {addressee === null
          ? "Сообщение ИИ-врачу"
          : `Вопрос специалисту: ${specialtyLabel[addressee]}`}
      </label>
      <div className="document-agent-workspace__composer-row">
        <textarea
          ref={props.composerRef}
          id="assistant-message"
          value={props.message}
          maxLength={2_000}
          rows={3}
          placeholder={
            !props.hasConversation
              ? "Сначала создайте диалог"
              : addressee === null
                ? "Например: что означают мои последние анализы?"
                : `Например: что вы как ${specialtyLabel[addressee]} видите в этих значениях?`
          }
          onChange={(event) => props.onMessageChange(event.target.value)}
          disabled={!props.canSend}
        />
        <button
          className="button button--primary document-agent-workspace__send"
          type="submit"
          disabled={!props.canSend || props.message.trim().length === 0}
        >
          <span>Отправить</span>
          <Send size={17} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      <div className="document-agent-workspace__composer-meta assistant-composer__meta">
        <span>{props.message.length} / 2000</span>
        {addressee !== null ? (
          <button
            type="button"
            className="assistant-composer__clear"
            onClick={() => props.onAddresseeChange(null)}
          >
            <X size={13} aria-hidden="true" />
            Снова к ИИ-врачу
          </button>
        ) : (
          <span>Каждый вывод — рекомендация для подтверждения у врача.</span>
        )}
        {props.hasConversation ? (
          <button
            type="button"
            className="button button--secondary assistant-composer__convene"
            onClick={props.onConvene}
            disabled={!props.canConvene}
            title={
              panel.length === 0
                ? "Среди подтверждённых значений нет профильных показателей"
                : `Пригласим: ${panel.map((item) => specialtyLabel[item.specialty]).join(", ")}`
            }
          >
            <Users size={16} aria-hidden="true" />
            {props.consiliumPending ? "Консилиум работает…" : "Собрать консилиум"}
          </button>
        ) : null}
      </div>
      {props.sendError !== null ? (
        <p className="form-error" role="alert">
          {props.sendError}
        </p>
      ) : null}
    </form>
  );
}
