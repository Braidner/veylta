"use client";

import type { AssistantCheckerVerdictRecord } from "@veylta/contracts";
import { checkerVerdictLabel } from "../assistant";
import { type ReferralBlock, referralActionCopy } from "../assistant-referrals";

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

/** The way from a block into the plan: one button per kind, one confirmation once it landed. */
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
  const copy = referralActionCopy(block);
  if (accepted) return <p className="assistant-block__accepted">{copy.accepted}</p>;
  return (
    <button
      type="button"
      className="button button--secondary assistant-block__referral"
      onClick={onAccept}
      disabled={pending}
    >
      {pending ? "Добавляем…" : copy.label}
    </button>
  );
}
