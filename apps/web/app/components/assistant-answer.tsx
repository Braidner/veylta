"use client";

import type {
  AssistantEvidenceRef,
  AssistantExchange,
  AssistantId,
  AssistantMessage,
} from "@veylta/contracts";
import { AlertTriangle, Bot, ClipboardCheck, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { refusalCopy, speakerLabel, specialtyLabel, urgencyCopy } from "../assistant";
import { isReferral, type ReferralBlock } from "../assistant-referrals";
import { formatDate } from "../format-moment";
import {
  BlockBody,
  BlockKind,
  CheckerNote,
  type EvidenceIndex,
  type RecordIndex,
  ReferralAction,
  SourceRefs,
} from "./assistant-blocks";
import { AssistantConsiliumView } from "./assistant-consilium";

type AssistantReply = Extract<AssistantMessage, { role: "assistant" }>;

const exchangeLabel: Record<AssistantExchange["stage"], string> = {
  answer: "Ответ",
  checker: "Проверяющий запуск",
  opinion: "Мнение специалиста",
  synthesis: "Синтез консилиума",
};

interface AssistantAnswerProps {
  readonly message: AssistantReply;
  readonly assistantId: AssistantId;
  readonly familyId: string;
  readonly profileId: string;
  readonly evidence: EvidenceIndex;
  readonly records: RecordIndex;
  readonly canWrite: boolean;
  /** Which referral blocks (`${messageId}:${index}`) already became care-plan items. */
  readonly acceptedReferrals: ReadonlySet<string>;
  readonly pendingReferral: string | null;
  readonly onAcceptReferral: (key: string, block: ReferralBlock) => void;
}

/** One assistant reply: fixed urgency copy first, then the typed blocks each bound to sources. */
export function AssistantAnswer({
  message,
  assistantId,
  familyId,
  profileId,
  evidence,
  records,
  canWrite,
  acceptedReferrals,
  pendingReferral,
  onAcceptReferral,
}: AssistantAnswerProps) {
  const [journalOpen, setJournalOpen] = useState(false);
  const verdicts = new Map(message.checker.map((verdict) => [verdict.blockIndex, verdict]));

  return (
    <article
      className={`assistant-answer${message.answer === null ? " is-refused" : ""}${message.consilium === null ? "" : " has-consilium"}`}
      data-testid="assistant-answer"
      data-speaker={message.speaker ?? "therapist"}
    >
      <header className="assistant-answer__meta">
        <span className="assistant-answer__mark" aria-hidden="true">
          {message.consilium === null ? <Bot size={15} /> : <Users size={15} />}
        </span>
        <strong>
          {speakerLabel(message.speaker, assistantId)}
          {message.consilium === null ? "" : " · синтез консилиума"}
        </strong>
        <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
      </header>

      {message.answer === null ? (
        <p className="assistant-answer__refusal" role="status">
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{refusalCopy[message.refusal ?? "schema_shape"]}</span>
        </p>
      ) : (
        <>
          <UrgencyBanner
            tier={message.answer.urgency.tier}
            reasons={message.answer.urgency.reasons}
            familyId={familyId}
            profileId={profileId}
            evidence={evidence}
          />
          <ol className="assistant-answer__blocks">
            {message.answer.blocks.map((block, index) => {
              const key = `${message.id}:${index}`;
              return (
                <li key={key} className={`assistant-block assistant-block--${block.kind}`}>
                  <BlockKind kind={block.kind} />
                  <div className="assistant-block__body">
                    <BlockBody
                      block={block}
                      familyId={familyId}
                      profileId={profileId}
                      evidence={evidence}
                      records={records}
                    />
                    <CheckerNote verdict={verdicts.get(index)} />
                    {isReferral(block) && canWrite ? (
                      <ReferralAction
                        block={block}
                        accepted={acceptedReferrals.has(key)}
                        pending={pendingReferral === key}
                        onAccept={() => onAcceptReferral(key, block)}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {message.consilium !== null ? (
        <AssistantConsiliumView
          consilium={message.consilium}
          familyId={familyId}
          profileId={profileId}
          evidence={evidence}
          records={records}
        />
      ) : null}

      <footer className="assistant-answer__footer">
        <span>Модель: {message.provenance.modelId}</span>
        {message.exchanges !== null && message.exchanges.length > 0 ? (
          <button
            type="button"
            className="assistant-answer__journal-toggle"
            aria-expanded={journalOpen}
            onClick={() => setJournalOpen((current) => !current)}
          >
            {journalOpen ? "Скрыть журнал обмена" : "Журнал обмена"}
          </button>
        ) : null}
      </footer>
      {journalOpen && message.exchanges !== null ? (
        <div className="assistant-answer__journal">
          {message.exchanges.map((exchange) => (
            <details
              key={`${exchange.stage}:${exchange.specialty ?? ""}`}
              className="assistant-answer__exchange"
            >
              <summary>
                {exchangeLabel[exchange.stage]}
                {exchange.specialty === null ? "" : ` (${specialtyLabel[exchange.specialty]})`} ·{" "}
                {exchange.modelId} · {exchange.durationMs} мс · запрос {exchange.requestBytes} Б,
                ответ {exchange.responseBytes} Б
              </summary>
              <pre>{exchange.requestText}</pre>
              <pre>
                {exchange.responseText.length === 0 ? "(нет ответа)" : exchange.responseText}
              </pre>
            </details>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function UrgencyBanner({
  tier,
  reasons,
  familyId,
  profileId,
  evidence,
}: {
  readonly tier: keyof typeof urgencyCopy;
  readonly reasons: readonly AssistantEvidenceRef[];
  readonly familyId: string;
  readonly profileId: string;
  readonly evidence: EvidenceIndex;
}) {
  const copy = urgencyCopy[tier];
  return (
    <div
      className={`assistant-urgency is-${copy.tone}`}
      role={copy.tone === "alarm" ? "alert" : "status"}
      data-testid="assistant-urgency"
    >
      {copy.tone === "calm" ? (
        <ClipboardCheck size={18} aria-hidden="true" />
      ) : (
        <AlertTriangle size={18} aria-hidden="true" />
      )}
      <div>
        <strong>{copy.label}</strong>
        <p>{copy.copy}</p>
        <SourceRefs refs={reasons} familyId={familyId} profileId={profileId} evidence={evidence} />
      </div>
    </div>
  );
}
