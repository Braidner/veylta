"use client";

import type {
  AssistantBlock,
  AssistantCheckerVerdictRecord,
  AssistantEvidenceRecordItem,
  AssistantEvidenceRef,
} from "@veylta/contracts";
import {
  BookOpen,
  CircleAlert,
  CircleHelp,
  ExternalLink,
  Lightbulb,
  type LucideIcon,
  Scale,
  ScanSearch,
  Stethoscope,
} from "lucide-react";
import {
  blockKindLabel,
  checkerVerdictLabel,
  clinicianCheckClaimCopy,
  confidenceLabel,
  contraindicationCopy,
  missingContextCopy,
  specialtyLabel,
  treatmentKindLabel,
} from "../assistant";
import type { ReferralBlock } from "../assistant-referrals";
import { clinicianRecordKindLabel } from "../clinician-records";
import { formatSampleMoment } from "../format-moment";
import { documentPath } from "../paths";
import { type EvidenceIndex, SourceRefs } from "./assistant-source-refs";

export type { EvidenceIndex } from "./assistant-source-refs";
export { SourceRefs } from "./assistant-source-refs";
export type { ReferralBlock };
export type RecordIndex = ReadonlyMap<string, AssistantEvidenceRecordItem>;

const blockIcon: Record<AssistantBlock["kind"], LucideIcon> = {
  interpretation: ScanSearch,
  hypothesis: Lightbulb,
  treatment_option: Stethoscope,
  clinician_check: Scale,
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
  readonly records: RecordIndex;
}

/** The clinician's record a сверка speaks to, with the way back to the document it came from. */
function TheirRecord({
  recordId,
  familyId,
  profileId,
  records,
}: { readonly recordId: string } & Pick<SourceContext, "familyId" | "profileId" | "records">) {
  const record = records.get(recordId);
  if (record === undefined) {
    return (
      <p className="assistant-check__theirs is-missing">запись врача больше не подтверждена</p>
    );
  }
  const kind = clinicianRecordKindLabel[record.kind as keyof typeof clinicianRecordKindLabel];
  return (
    <p className="assistant-check__theirs">
      <span>Врач · {kind ?? record.kind}</span>
      <a href={documentPath(familyId, profileId, record.documentId)}>
        {record.label}
        {record.detail === null ? "" : ` · ${record.detail}`}
        {record.documentDate === null ? "" : ` · ${formatSampleMoment(record.documentDate)}`}
        <ExternalLink size={12} aria-hidden="true" />
      </a>
    </p>
  );
}

export function BlockBody({
  block,
  familyId,
  profileId,
  evidence,
  records,
}: SourceContext & { readonly block: AssistantBlock }) {
  const refs = (list: readonly AssistantEvidenceRef[]) => (
    <SourceRefs refs={list} familyId={familyId} profileId={profileId} evidence={evidence} />
  );
  switch (block.kind) {
    case "clinician_check": {
      const claim = clinicianCheckClaimCopy[block.claim];
      return (
        <>
          <span className={`assistant-check__claim is-${claim.tone}`}>{claim.label}</span>
          <TheirRecord
            recordId={block.theirs.recordId}
            familyId={familyId}
            profileId={profileId}
            records={records}
          />
          <p>
            <strong>ИИ-врач:</strong> {block.ours}
          </p>
          <p className="assistant-block__meta">
            {block.why} · обсудить: {specialtyLabel[block.confirmWith]}
          </p>
          {refs(block.refs)}
        </>
      );
    }
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
  const discuss = block.kind === "clinician_check";
  if (accepted) {
    return (
      <p className="assistant-block__accepted">
        {discuss
          ? "Добавлено в план: обсудить с врачом."
          : "Добавлено в план: подтвердить у врача."}
      </p>
    );
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
        : discuss
          ? `В план: обсудить с врачом (${specialtyLabel[block.confirmWith]})`
          : `В план: подтвердить у специалиста (${specialtyLabel[block.confirmWith]})`}
    </button>
  );
}
