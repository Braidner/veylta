"use client";

import type { AssistantId, AssistantOutcomeSummary } from "@veylta/contracts";
import { ClipboardCheck } from "lucide-react";
import { useState } from "react";
import {
  checkCountsCopy,
  outcomeCountsCopy,
  outcomesEmpty,
  outcomeVerdictCopy,
} from "../assistant-outcomes";
import { formatSampleMoment } from "../format-moment";

const shownEntries = 8;

/**
 * The room's outcome log at a glance: how often the clinician confirmed, changed or rejected what
 * the assistant proposed, how the сверка stood, and the marked cases with a way back to each
 * conversation. Counts and cases only — never a rating of a doctor.
 */
export function AssistantOutcomes({
  assistantId,
  summary,
  onOpenConversation,
}: {
  readonly assistantId: AssistantId;
  readonly summary: AssistantOutcomeSummary;
  readonly onOpenConversation: (conversationId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const entries = expanded ? summary.entries : summary.entries.slice(0, shownEntries);
  const rest = summary.entries.length - entries.length;
  return (
    <section
      className="assistant-outcomes"
      aria-labelledby="assistant-outcomes-title"
      data-testid="assistant-outcomes"
    >
      <h3 id="assistant-outcomes-title">
        <ClipboardCheck size={14} aria-hidden="true" />
        Исходы
      </h3>
      {outcomesEmpty(summary) ? (
        <p className="assistant-outcomes__empty">
          Здесь соберётся, что сказал врач о предложенном: отметьте это под блоком ответа после
          визита.
        </p>
      ) : (
        <>
          <p className="assistant-outcomes__counts">{outcomeCountsCopy(summary.counts)}</p>
          {assistantId === "physician" ? (
            <p className="assistant-outcomes__counts">{checkCountsCopy(summary.checks)}</p>
          ) : null}
          {entries.length > 0 ? (
            <ul className="assistant-outcomes__list">
              {entries.map((entry) => (
                <li key={`${entry.messageId}:${entry.blockIndex}`}>
                  <span
                    className={`assistant-outcome__chip is-${outcomeVerdictCopy[entry.verdict].tone}`}
                  >
                    {outcomeVerdictCopy[entry.verdict].label}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onOpenConversation(entry.conversationId)}
                    title={entry.conversationTitle}
                  >
                    {entry.title}
                  </button>
                  {entry.decidedOn === null ? null : (
                    <small>{formatSampleMoment(entry.decidedOn)}</small>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {rest > 0 ? (
            <button type="button" className="text-button" onClick={() => setExpanded(true)}>
              Ещё {rest}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
