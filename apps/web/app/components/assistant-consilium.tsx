"use client";

import type { AssistantConsilium, AssistantOpinion } from "@veylta/contracts";
import { Users } from "lucide-react";
import { agreementVerdictLabel, refusalCopy, specialtyLabel, urgencyCopy } from "../assistant";
import { invitationCopy } from "../assistant-invitations";
import {
  BlockBody,
  BlockKind,
  CheckerNote,
  type EvidenceIndex,
  type RecordIndex,
  SourceRefs,
} from "./assistant-blocks";

interface AssistantConsiliumProps {
  readonly consilium: AssistantConsilium;
  readonly familyId: string;
  readonly profileId: string;
  readonly evidence: EvidenceIndex;
  readonly records: RecordIndex;
}

/**
 * The консилиум under the therapist's synthesis: every persona's own opinion side by side —
 * verified blocks or its refusal, never averaged — then where the synthesis found them agreeing
 * or differing. Each specialist card names the observations that convened them.
 */
export function AssistantConsiliumView({
  consilium,
  familyId,
  profileId,
  evidence,
  records,
}: AssistantConsiliumProps) {
  const reasons = new Map(consilium.invitations.map((item) => [item.specialty, item]));
  return (
    <section
      className="assistant-consilium"
      aria-label="Мнения консилиума"
      data-testid="assistant-consilium"
    >
      <h5>
        <Users size={16} aria-hidden="true" />
        Мнения консилиума
      </h5>
      <ol className="assistant-consilium__opinions">
        {consilium.opinions.map((opinion) => {
          const invitation = reasons.get(opinion.specialty);
          return (
            <li
              key={opinion.specialty}
              className="assistant-opinion"
              data-specialty={opinion.specialty}
            >
              <header>
                <strong>{specialtyLabel[opinion.specialty]}</strong>
                <span>
                  {invitation === undefined
                    ? "по вашему запросу"
                    : invitationCopy(invitation, evidence)}
                </span>
              </header>
              <OpinionBody
                opinion={opinion}
                familyId={familyId}
                profileId={profileId}
                evidence={evidence}
                records={records}
              />
            </li>
          );
        })}
      </ol>
      {consilium.agreements.length > 0 ? (
        <div className="assistant-consilium__agreements">
          <h6>Где мнения сходятся и расходятся</h6>
          <ul>
            {consilium.agreements.map((note) => (
              <li key={`${note.topic}:${note.verdict}`} className={`is-${note.verdict}`}>
                <span className="assistant-consilium__verdict">
                  {agreementVerdictLabel[note.verdict]}
                </span>
                <strong>{note.topic}</strong>
                <small>{note.specialties.map((item) => specialtyLabel[item]).join(", ")}</small>
                <p>{note.why}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function OpinionBody({
  opinion,
  familyId,
  profileId,
  evidence,
  records,
}: { readonly opinion: AssistantOpinion } & Omit<AssistantConsiliumProps, "consilium">) {
  if (opinion.answer === null) {
    return (
      <p className="assistant-opinion__refusal">{refusalCopy[opinion.refusal ?? "schema_shape"]}</p>
    );
  }
  const urgency = urgencyCopy[opinion.answer.urgency.tier];
  const verdicts = new Map(opinion.checker.map((verdict) => [verdict.blockIndex, verdict]));
  return (
    <>
      <p className={`assistant-opinion__urgency is-${urgency.tone}`}>{urgency.label}</p>
      <ol className="assistant-opinion__blocks">
        {opinion.answer.blocks.map((block, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks have no identity beyond their position in the verified answer.
          <li key={`${opinion.specialty}:${index}`} className="assistant-block">
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
            </div>
          </li>
        ))}
      </ol>
      <SourceRefs
        refs={opinion.answer.urgency.reasons}
        familyId={familyId}
        profileId={profileId}
        evidence={evidence}
      />
    </>
  );
}
