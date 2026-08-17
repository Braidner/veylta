"use client";

import { ArrowLeft, ClipboardList } from "lucide-react";
import { assistantIntro, assistantTitle } from "../assistant";
import { profileTabPath } from "../paths";
import { PageHero } from "./page-hero";

/** The assistant view is a detail surface like a document: the one hero, thinly wrapped. */
export function AssistantHero({
  familyId,
  profileId,
}: {
  readonly familyId: string;
  readonly profileId: string;
}) {
  return (
    <PageHero
      testId="assistant-hero"
      titleId="assistant-hero-title"
      contextLine="Второе мнение"
      title={assistantTitle}
      meta={assistantIntro}
      actionsLabel="Переходы"
      actions={
        <>
          <a
            className="button page-hero__action"
            href={profileTabPath(familyId, profileId, "overview")}
          >
            <ArrowLeft size={17} aria-hidden="true" />К обзору
          </a>
          <a
            className="button page-hero__action"
            href={profileTabPath(familyId, profileId, "plan")}
          >
            <ClipboardList size={17} aria-hidden="true" />
            Медпрофиль и план
          </a>
        </>
      }
    />
  );
}
