"use client";

import type {
  AssistantBlock,
  AssistantCheckerVerdictRecord,
  AssistantEvidenceItem,
  AssistantEvidenceRef,
} from "@veylta/contracts";
import {
  BookOpen,
  CircleAlert,
  CircleHelp,
  ExternalLink,
  Lightbulb,
  type LucideIcon,
  ScanSearch,
  Stethoscope,
} from "lucide-react";
import {
  blockKindLabel,
  checkerVerdictLabel,
  confidenceLabel,
  contraindicationCopy,
  missingContextCopy,
  specialtyLabel,
  treatmentKindLabel,
} from "../assistant";
import { documentPath } from "../paths";

export type ReferralBlock = Extract<AssistantBlock, { kind: "hypothesis" | "treatment_option" }>;
export type EvidenceIndex = ReadonlyMap<string, AssistantEvidenceItem>;

const blockIcon: Record<AssistantBlock["kind"], LucideIcon> = {
  interpretation: ScanSearch,
  hypothesis: Lightbulb,
  treatment_option: Stethoscope,
  question: CircleHelp,
  general: BookOpen,
  missing: CircleAlert,
};

/** The block's kind as a kicker — an icon and the fixed label, the same for every answer. */
export function BlockKind({ kind }: { readonly kind: AssistantBlock["kind"] }) {
  const Icon = blockIcon[kind];
  return (
    <span className="assistant-block__kind">
      <Icon size={14} aria-hidden="true" />
      {blockKindLabel[kind]}
    </span>
  );
}

interface SourceContext {
  readonly familyId: string;
  readonly profileId: string;
  readonly evidence: EvidenceIndex;
}

export function BlockBody({
  block,
  familyId,
  profileId,
  evidence,
}: SourceContext & { readonly block: AssistantBlock }) {
  const refs = (list: readonly AssistantEvidenceRef[]) => (
    <SourceRefs refs={list} familyId={familyId} profileId={profileId} evidence={evidence} />
  );
  switch (block.kind) {
    case "interpretation":
    case "question":
      return (
        <>
          <p>{block.text}</p>
          {refs(block.refs)}
        </>
      );
    case "general":
      return <p>{block.text}</p>;
    case "missing":
      return <p>{missingContextCopy[block.context]}</p>;
    case "hypothesis":
      return (
        <>
          <h5>{block.name}</h5>
          <p className="assistant-block__meta">
            {confidenceLabel[block.confidence]} · подтвердить: {specialtyLabel[block.confirmWith]}
          </p>
          <p>{block.rationale}</p>
          {block.workup.length > 0 ? (
            <p className="assistant-block__workup">
              Что обычно проверяют: {block.workup.join("; ")}
            </p>
          ) : null}
          {refs(block.refs)}
        </>
      );
    case "treatment_option":
      return (
        <>
          <h5>{block.name}</h5>
          <p className="assistant-block__meta">
            {treatmentKindLabel[block.treatmentKind]} ·{" "}
            {contraindicationCopy[block.contraindications]} · подтвердить:{" "}
            {specialtyLabel[block.confirmWith]}
          </p>
          <p>{block.rationale}</p>
          {block.conflictNotes !== null ? (
            <p className="assistant-block__conflict">{block.conflictNotes}</p>
          ) : null}
          {refs(block.refs)}
        </>
      );
  }
}

export function CheckerNote({
  verdict,
}: {
  readonly verdict: AssistantCheckerVerdictRecord | undefined;
}) {
  if (verdict === undefined || verdict.verdict === "supported") return null;
  return (
    <p className="assistant-block__checker">
      Проверяющий запуск: {checkerVerdictLabel[verdict.verdict]}
      {verdict.note === null ? "" : ` — ${verdict.note}`}
    </p>
  );
}

export function ReferralAction({
  block,
  accepted,
  pending,
  onAccept,
}: {
  readonly block: ReferralBlock;
  readonly accepted: boolean;
  readonly pending: boolean;
  readonly onAccept: () => void;
}) {
  if (accepted) {
    return <p className="assistant-block__accepted">Добавлено в план: подтвердить у врача.</p>;
  }
  return (
    <button
      type="button"
      className="button button--secondary assistant-block__referral"
      onClick={onAccept}
      disabled={pending}
    >
      {pending
        ? "Добавляем…"
        : `В план: подтвердить у специалиста (${specialtyLabel[block.confirmWith]})`}
    </button>
  );
}

/** Every ref opens the page the value was confirmed from; an unknown id is shown, not hidden. */
export function SourceRefs({
  refs,
  familyId,
  profileId,
  evidence,
}: SourceContext & { readonly refs: readonly AssistantEvidenceRef[] }) {
  if (refs.length === 0) return null;
  return (
    <ul className="assistant-refs" aria-label="Источники">
      <li className="assistant-refs__label">Источники</li>
      {refs.map((ref) => {
        const item = evidence.get(ref.observationId);
        if (item === undefined) {
          return (
            <li key={ref.observationId} className="assistant-refs__missing">
              значение больше не подтверждено
            </li>
          );
        }
        return (
          <li key={ref.observationId}>
            <a href={documentPath(familyId, profileId, item.documentId)}>
              <span>
                {item.name} {item.value} {item.unit}
              </span>
              <small>стр. {item.pageNumber}</small>
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
