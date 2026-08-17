import type { AssistantAnswer, AssistantBlock, CarePlanItemCreateRequest } from "@veylta/contracts";
import { specialtyLabel } from "./assistant";

export type ReferralBlock = Extract<
  AssistantBlock,
  {
    kind: "hypothesis" | "treatment_option" | "clinician_check" | "diet_recommendation" | "recheck";
  }
>;

/** Is this block a way into the plan? A сверка only when it differs; agreement offers nothing. */
export function isReferral(block: AssistantBlock): block is ReferralBlock {
  switch (block.kind) {
    case "hypothesis":
    case "treatment_option":
    case "diet_recommendation":
    case "recheck":
      return true;
    case "clinician_check":
      return block.claim === "differs";
    default:
      return false;
  }
}

/**
 * Accepting a referral: one plan item phrased from the block. A hypothesis or a treatment option
 * becomes a clinician item; a сверка that differs «обсудить с врачом» over the record it speaks
 * to; a diet recommendation goes into the nutrition lane and a recheck into the laboratory lane —
 * with the phrase the assistant used, never a date Veylta computed.
 */
export function referralItem(block: ReferralBlock, recordLabel = ""): CarePlanItemCreateRequest {
  switch (block.kind) {
    case "clinician_check":
      return {
        category: "clinician",
        title:
          `Обсудить с врачом (${specialtyLabel[block.confirmWith]}): ${recordLabel || "запись врача"}`.slice(
            0,
            120,
          ),
        note: `${block.ours} ${block.why}`.slice(0, 500),
        scheduledFor: null,
      };
    case "diet_recommendation":
      return {
        category: "nutrition",
        title: block.name.slice(0, 120),
        note: [
          block.rationale,
          ...(block.conflictNotes === null ? [] : [`Внимание: ${block.conflictNotes}`]),
          `Подтвердить: ${specialtyLabel[block.confirmWith]}.`,
        ]
          .join(" ")
          .slice(0, 500),
        scheduledFor: null,
      };
    case "recheck":
      return {
        category: "laboratory",
        title: block.text.slice(0, 120),
        note: `Когда: ${block.when}.`.slice(0, 500),
        scheduledFor: null,
      };
    default:
      return {
        category: "clinician",
        title:
          `Подтвердить у специалиста (${specialtyLabel[block.confirmWith]}): ${block.name}`.slice(
            0,
            120,
          ),
        note: block.rationale.slice(0, 500),
        scheduledFor: null,
      };
  }
}

/** The button and the confirmation for one referral kind. */
export function referralActionCopy(block: ReferralBlock): {
  readonly label: string;
  readonly accepted: string;
} {
  switch (block.kind) {
    case "clinician_check":
      return {
        label: `В план: обсудить с врачом (${specialtyLabel[block.confirmWith]})`,
        accepted: "Добавлено в план: обсудить с врачом.",
      };
    case "diet_recommendation":
      return { label: "В план: питание", accepted: "Добавлено в план питания." };
    case "recheck":
      return {
        label: "В план: повторить анализ",
        accepted: "Добавлено в план: повторить анализ.",
      };
    default:
      return {
        label: `В план: подтвердить у специалиста (${specialtyLabel[block.confirmWith]})`,
        accepted: "Добавлено в план: подтвердить у врача.",
      };
  }
}

/** The blocks that offer a way into the plan. */
export function referralsOf(answer: AssistantAnswer) {
  return answer.blocks.filter(isReferral);
}
