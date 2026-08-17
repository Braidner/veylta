"use client";

import type { AssistantSpecialty } from "@veylta/contracts";
import { Bot } from "lucide-react";
import type { ReactNode } from "react";
import { specialtyLabel } from "../assistant";

/** What to ask first: three questions the assistant answers well, put into the field on click. */
const openers = [
  "Что означают мои последние анализы?",
  "Что из моих значений требует внимания в первую очередь и насколько срочно?",
  "Что стоит уточнить у врача до визита?",
] as const;

export function Openers({ onPick }: { readonly onPick: (text: string) => void }) {
  return (
    <div className="assistant-openers" data-testid="assistant-openers">
      <p>О чём спросить</p>
      <ul>
        {openers.map((opener) => (
          <li key={opener}>
            <button type="button" onClick={() => onPick(opener)}>
              {opener}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Waiting({ children }: { readonly children: ReactNode }) {
  return (
    <div className="assistant-waiting" role="status">
      <Bot size={16} strokeWidth={1.8} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** The person's own message: right-aligned, with the persona it was addressed to, if any. */
export function UserMessage({
  text,
  addressee,
  pending = false,
}: {
  readonly text: string;
  readonly addressee: AssistantSpecialty | null;
  readonly pending?: boolean;
}) {
  return (
    <article className={`assistant-message assistant-message--user${pending ? " is-pending" : ""}`}>
      {addressee !== null ? <small>Вопрос: {specialtyLabel[addressee]}</small> : null}
      <p>{text}</p>
    </article>
  );
}
