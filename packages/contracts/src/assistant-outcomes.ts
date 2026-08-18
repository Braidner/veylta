/**
 * The outcome log: what the clinician said about a block the assistant proposed — confirmed,
 * rejected or modified — as the person recorded it, dated by them and, when they choose, tied to
 * the confirmed clinician record that says so. Append-only; the latest mark per block stands.
 * Shown as counts with links to the cases, never as a rating of a named doctor.
 */
import type { AssistantBlock, AssistantClinicianCheckClaim } from "./assistant-blocks.js";

export const ASSISTANT_OUTCOME_VERDICTS = ["confirmed", "rejected", "modified"] as const;
export type AssistantOutcomeVerdict = (typeof ASSISTANT_OUTCOME_VERDICTS)[number];
/** The blocks a clinician's word can be recorded against — everything the answer asks to confirm. */
export const ASSISTANT_OUTCOME_BLOCK_KINDS = [
  "hypothesis",
  "treatment_option",
  "diet_recommendation",
  "activity_recommendation",
  "clinician_check",
] as const satisfies readonly AssistantBlock["kind"][];
export type AssistantOutcomeBlockKind = (typeof ASSISTANT_OUTCOME_BLOCK_KINDS)[number];
export const MAX_ASSISTANT_OUTCOME_NOTE_LENGTH = 500;
export const MAX_ASSISTANT_OUTCOME_ENTRIES = 100;

/** `PUT …/messages/:messageId/blocks/:blockIndex/outcome` — the clinician's word on one block. */
export interface AssistantOutcomeRequest {
  readonly verdict: AssistantOutcomeVerdict;
  /** The day the clinician said so, as the person enters it (YYYY-MM-DD), or unknown. */
  readonly decidedOn: string | null;
  readonly note: string | null;
  /** A confirmed clinician record that documents the word, or none. */
  readonly recordId: string | null;
}

/** The latest mark on one block of one answer. */
export interface AssistantOutcome extends AssistantOutcomeRequest {
  readonly blockIndex: number;
  readonly recordedAt: string;
}

/** One marked block as the room's log lists it, with the way back to the answer. */
export interface AssistantOutcomeEntry extends AssistantOutcome {
  readonly conversationId: string;
  readonly conversationTitle: string;
  readonly messageId: string;
  readonly blockKind: AssistantOutcomeBlockKind;
  /** The block's own name or, for a сверка, the assistant's position — what the mark is about. */
  readonly title: string;
}

/** The room's log at a glance: counts, the сверка's claims so far, the marked blocks newest first. */
export interface AssistantOutcomeSummary {
  readonly counts: Readonly<Record<AssistantOutcomeVerdict, number>>;
  /** How the assistant's сверка stood to the clinicians' records across the room's answers. */
  readonly checks: Readonly<Record<AssistantClinicianCheckClaim, number>>;
  readonly entries: readonly AssistantOutcomeEntry[];
}
