"use client";

import type { AssistantEvidenceItem, AssistantInvitation } from "@veylta/contracts";
import { Send, Stethoscope, Users } from "lucide-react";
import type { FormEvent, ReactNode, RefObject } from "react";
import { invitationCopy, invitationSummary, specialtyLabel } from "../assistant";
import type { Recipient } from "../use-assistant-composer";

interface AssistantComposerProps {
  readonly message: string;
  readonly recipient: Recipient;
  readonly canSend: boolean;
  readonly canConvene: boolean;
  readonly consiliumPending: boolean;
  readonly panel: readonly AssistantInvitation[];
  readonly evidence: ReadonlyMap<string, AssistantEvidenceItem>;
  readonly hasConversation: boolean;
  readonly sendError: string | null;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onMessageChange: (message: string) => void;
  readonly onRecipientChange: (recipient: Recipient) => void;
  readonly onSend: (event: FormEvent<HTMLFormElement>) => void;
}

/** «Сообщение ИИ-врачу», «Вопрос специалисту: гематолог», «Вопрос консилиуму» — the field's name. */
export function composerLabel(recipient: Recipient): string {
  if (recipient === null) return "Сообщение ИИ-врачу";
  if (recipient === "consilium") return "Вопрос консилиуму";
  return `Вопрос специалисту: ${specialtyLabel[recipient]}`;
}

function RecipientChip({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly disabled: boolean;
  readonly title?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        className={`assistant-chip${active ? " is-active" : ""}`}
        aria-pressed={active}
        title={title}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    </li>
  );
}

/**
 * «Кому + что»: one row of recipients — the therapist, each specialist the evidence names (with
 * how many of the person's values put them there), the whole консилиум — then the field. The
 * primary button follows the recipient: a message, or «Собрать консилиум», where the typed text
 * becomes the question every specialist and the synthesis answer.
 */
export function AssistantComposer(props: AssistantComposerProps) {
  const { panel, recipient, evidence } = props;
  const chosen = recipient === null || recipient === "consilium" ? null : recipient;
  const invitation = chosen === null ? null : panel.find((item) => item.specialty === chosen);
  const consilium = recipient === "consilium";
  const submitDisabled = consilium
    ? !props.canConvene
    : !props.canSend || props.message.trim().length === 0;
  const hint =
    recipient === null
      ? "Читает все подтверждённые значения и ваш профиль; каждый вывод — рекомендация для разговора с врачом."
      : consilium
        ? panel.length === 0
          ? "Среди подтверждённых значений нет профильных показателей — созывать некого."
          : `Пригласим: ${panel.map((item) => specialtyLabel[item.specialty]).join(", ")} — каждый читает те же значения, ИИ-врач сводит мнения.`
        : invitation === undefined || invitation === null
          ? `${specialtyLabel[recipient]} · по вашему запросу`
          : `${specialtyLabel[recipient]} · ${invitationSummary(invitation, evidence)}`;
  return (
    <form className="assistant-composer" onSubmit={props.onSend}>
      {props.hasConversation ? (
        <div className="assistant-composer__to" data-testid="assistant-consilium-panel">
          <span className="assistant-composer__to-label">Кому</span>
          <ul className="assistant-composer__chips" aria-label="Кому адресован вопрос">
            <RecipientChip
              active={recipient === null}
              disabled={!props.canSend}
              onClick={() => props.onRecipientChange(null)}
            >
              <Stethoscope size={14} aria-hidden="true" />
              ИИ-врач
            </RecipientChip>
            {panel.map((item) => (
              <RecipientChip
                key={item.specialty}
                active={recipient === item.specialty}
                disabled={!props.canSend}
                title={invitationCopy(item, evidence)}
                onClick={() =>
                  props.onRecipientChange(recipient === item.specialty ? null : item.specialty)
                }
              >
                {specialtyLabel[item.specialty]}
                <b>{new Set(item.observationIds).size}</b>
              </RecipientChip>
            ))}
            <RecipientChip
              active={consilium}
              disabled={!props.canSend || panel.length === 0}
              title={
                panel.length === 0
                  ? "Среди подтверждённых значений нет профильных показателей"
                  : `Пригласим: ${panel.map((item) => specialtyLabel[item.specialty]).join(", ")}`
              }
              onClick={() => props.onRecipientChange(consilium ? null : "consilium")}
            >
              <Users size={14} aria-hidden="true" />
              Консилиум
              {panel.length > 0 ? <b>{panel.length}</b> : null}
            </RecipientChip>
          </ul>
          <p className="assistant-composer__hint">{hint}</p>
        </div>
      ) : null}
      <label htmlFor="assistant-message" className="visually-hidden">
        {composerLabel(recipient)}
      </label>
      <div className="assistant-composer__field">
        <textarea
          ref={props.composerRef}
          id="assistant-message"
          value={props.message}
          maxLength={2_000}
          rows={3}
          placeholder={
            !props.hasConversation
              ? "Сначала выберите или создайте диалог"
              : consilium
                ? "Вопрос консилиуму — или оставьте пустым, каждый ответит по своим данным"
                : recipient === null
                  ? "Например: что означают мои последние анализы?"
                  : `Например: что вы как ${specialtyLabel[recipient]} видите в этих значениях?`
          }
          onChange={(event) => props.onMessageChange(event.target.value)}
          disabled={!props.canSend}
        />
        <button
          className="button button--primary assistant-composer__send"
          type="submit"
          disabled={submitDisabled}
        >
          {consilium ? (
            <>
              <Users size={16} aria-hidden="true" />
              {props.consiliumPending ? "Консилиум работает…" : "Собрать консилиум"}
            </>
          ) : (
            <>
              Отправить
              <Send size={16} strokeWidth={2} aria-hidden="true" />
            </>
          )}
        </button>
      </div>
      <div className="assistant-composer__meta">
        <span>{props.message.length} / 2000</span>
        <span>Ответ проверяет второй независимый запуск; ничего не уходит без вашей отправки.</span>
      </div>
      {props.sendError !== null ? (
        <p className="form-error" role="alert">
          {props.sendError}
        </p>
      ) : null}
    </form>
  );
}
