import {
  ASSISTANT_CHECKER_VERDICTS,
  ASSISTANT_URGENCY_TIERS,
  type AssistantAnswer,
  type AssistantBlock,
  type AssistantCheckerVerdictRecord,
  type AssistantUrgencyTier,
} from "@veylta/contracts";
import {
  boundedList,
  boundedText,
  exactKeys,
  keepEach,
  member,
  object,
  refuse,
} from "./answer-fields.js";

export interface CheckerVerdicts {
  readonly verdicts: readonly AssistantCheckerVerdictRecord[];
  readonly urgency: AssistantUrgencyTier;
}

/** The checker's own JSON: one verdict per block index and its independent urgency read. */
export function parseCheckerVerdicts(text: string, blockCount: number): CheckerVerdicts {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    refuse("schema_shape");
  }
  const root = object(parsed);
  exactKeys(root, ["verdicts", "urgency"]);
  const seen = new Set<number>();
  const verdicts = keepEach(boundedList(root.verdicts, blockCount), (proposal) => {
    const record = object(proposal);
    exactKeys(record, ["blockIndex", "verdict", "note"]);
    if (
      !Number.isSafeInteger(record.blockIndex) ||
      (record.blockIndex as number) < 0 ||
      (record.blockIndex as number) >= blockCount ||
      seen.has(record.blockIndex as number)
    ) {
      refuse("schema_shape");
    }
    seen.add(record.blockIndex as number);
    return {
      blockIndex: record.blockIndex as number,
      verdict: member(record.verdict, ASSISTANT_CHECKER_VERDICTS),
      note: record.note === null ? null : boundedText(record.note, 300),
    };
  });
  return { verdicts, urgency: member(root.urgency, ASSISTANT_URGENCY_TIERS) };
}

const confidenceBelow = { high: "moderate", moderate: "low", low: "low" } as const;

function lowered(block: AssistantBlock, note: string | null): AssistantBlock {
  if (block.kind === "hypothesis") {
    return { ...block, confidence: confidenceBelow[block.confidence] };
  }
  if (block.kind === "treatment_option" && note !== null) {
    return { ...block, conflictNotes: block.conflictNotes ?? note };
  }
  return block;
}

/**
 * Applies the checker: a block it found contradicted or unsafe is dropped, one it found
 * overreaching keeps its place with lower confidence, and the higher of the two urgency reads
 * wins — a second run may lower a claim, never the alarm. Returns null when nothing survives.
 */
export function applyCheckerVerdicts(
  answer: AssistantAnswer,
  checker: CheckerVerdicts,
): AssistantAnswer | null {
  const byIndex = new Map(checker.verdicts.map((verdict) => [verdict.blockIndex, verdict]));
  const blocks = answer.blocks.flatMap((block, index) => {
    const verdict = byIndex.get(index);
    if (verdict === undefined || verdict.verdict === "supported") return [block];
    if (verdict.verdict === "overreach") return [lowered(block, verdict.note)];
    return [];
  });
  const tiers = ASSISTANT_URGENCY_TIERS;
  const tier =
    tiers.indexOf(checker.urgency) > tiers.indexOf(answer.urgency.tier)
      ? checker.urgency
      : answer.urgency.tier;
  if (blocks.length === 0 && answer.blocks.length > 0) return null;
  return { urgency: { ...answer.urgency, tier }, blocks };
}
