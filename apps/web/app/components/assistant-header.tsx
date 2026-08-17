"use client";

import { ArrowLeft, Bot, ContactRound } from "lucide-react";
import Link from "next/link";
import { assistantTitle } from "../assistant";
import { profileTabPath } from "../paths";

/**
 * The assistant page opens on the conversation, not on a banner: one line names the surface and
 * its rule, the two ways out sit on the right. The gradient stays with the primary action.
 */
export function AssistantHeader({
  familyId,
  profileId,
}: {
  readonly familyId: string;
  readonly profileId: string;
}) {
  return (
    <header className="assistant-header" data-testid="assistant-header">
      <div className="assistant-header__identity">
        <span className="assistant-header__mark" aria-hidden="true">
          <Bot size={18} />
        </span>
        <div>
          <h1 id="assistant-header-title">{assistantTitle}</h1>
          <p>
            Разбирает только подтверждённые значения с учётом вашего профиля. Каждый вывод —
            рекомендация для разговора с врачом, а не диагноз и не назначение.
          </p>
        </div>
      </div>
      <nav className="assistant-header__actions" aria-label="Переходы">
        <Link
          className="button button--secondary"
          href={profileTabPath(familyId, profileId, "overview")}
        >
          <ArrowLeft size={16} aria-hidden="true" />К обзору
        </Link>
        <Link
          className="button button--secondary"
          href={profileTabPath(familyId, profileId, "dossier")}
        >
          <ContactRound size={16} aria-hidden="true" />
          Досье
        </Link>
      </nav>
    </header>
  );
}
