import type { AssistantAnswer, AssistantBlock, CarePlanItemCreateRequest } from "@veylta/contracts";
import { specialtyLabel } from "./assistant";

export type ReferralBlock = Extract<
  AssistantBlock,
  { kind: "hypothesis" | "treatment_option" | "clinician_check" }
>;

/**
 * Accepting a referral: one clinician item, phrased from the block, for the care plan. A сверка
 * that differs becomes «обсудить с врачом» over the record it speaks to.
 */
export function referralItem(block: ReferralBlock, recordLabel = ""): CarePlanItemCreateRequest {
  const specialty = specialtyLabel[block.confirmWith];
  if (block.kind === "clinician_check") {
    return {
      category: "clinician",
      title: `Обсудить с врачом (${specialty}): ${recordLabel || "запись врача"}`.slice(0, 120),
      note: `${block.ours} ${block.why}`.slice(0, 500),
      scheduledFor: null,
    };
  }
  const title = `Подтвердить у специалиста (${specialty}): ${block.name}`.slice(0, 120);
  return {
    category: "clinician",
    title,
    note: block.rationale.slice(0, 500),
    scheduledFor: null,
  };
}

/** The blocks that offer a way into the plan: referrals, and a сверка that differs. */
export function referralsOf(answer: AssistantAnswer) {
  return answer.blocks.filter(
    (block): block is ReferralBlock =>
      block.kind === "hypothesis" ||
      block.kind === "treatment_option" ||
      (block.kind === "clinician_check" && block.claim === "differs"),
  );
}
