/**
 * The assistant workspace: conversations, messages, the консилиум and the requests that drive
 * them. The answer model itself lives in ./assistant.ts.
 */
import type {
  ASSISTANT_CONTRACT_VERSION,
  ASSISTANT_EGRESS_ACKNOWLEDGEMENT,
  AssistantAgreementVerdict,
  AssistantAnswer,
  AssistantCheckerVerdict,
  AssistantEvidenceItem,
  AssistantId,
  AssistantRejectionReason,
  AssistantSpecialty,
} from "./assistant.js";

/** One raw attempt, kept for the owner exactly like a processing run's exchange. */
export interface AssistantExchange {
  readonly stage: "answer" | "checker" | "opinion" | "synthesis";
  /** The persona behind an opinion; null for the therapist's own runs and the checker. */
  readonly specialty: AssistantSpecialty | null;
  readonly requestText: string;
  readonly responseText: string;
  readonly requestBytes: number;
  readonly responseBytes: number;
  readonly modelId: string;
  readonly runtimeVersion: string | null;
  readonly durationMs: number;
}

export interface AssistantCheckerVerdictRecord {
  readonly blockIndex: number;
  readonly verdict: AssistantCheckerVerdict;
  readonly note: string | null;
}

/** Why a specialist joins the консилиум: the confirmed observations that fall in their field. */
export interface AssistantInvitation {
  readonly specialty: AssistantSpecialty;
  readonly observationIds: readonly string[];
}

/** One specialist persona's own read of the same evidence, verified like any answer. */
export interface AssistantOpinion {
  readonly specialty: AssistantSpecialty;
  readonly answer: AssistantAnswer | null;
  readonly refusal: AssistantRejectionReason | null;
  readonly checker: readonly AssistantCheckerVerdictRecord[];
}

/** Where the therapist's synthesis found the specialists agreeing or differing, and why. */
export interface AssistantAgreement {
  readonly topic: string;
  readonly verdict: AssistantAgreementVerdict;
  readonly specialties: readonly AssistantSpecialty[];
  readonly why: string;
}

export interface AssistantConsilium {
  readonly invitations: readonly AssistantInvitation[];
  readonly opinions: readonly AssistantOpinion[];
  readonly agreements: readonly AssistantAgreement[];
}

export type AssistantMessage =
  | {
      readonly id: string;
      readonly role: "user";
      readonly text: string;
      /** A question addressed to one persona («Спросить эндокринолога»); null for the therapist. */
      readonly addressee: AssistantSpecialty | null;
      readonly createdAt: string;
    }
  | {
      readonly id: string;
      readonly role: "assistant";
      /** Who answered: null is the therapist («ИИ-врач»); a specialty is that persona alone. */
      readonly speaker: AssistantSpecialty | null;
      readonly answer: AssistantAnswer | null;
      /** Set when the answer was refused; the UI shows fixed copy for the reason. */
      readonly refusal: AssistantRejectionReason | null;
      readonly checker: readonly AssistantCheckerVerdictRecord[];
      /** Present when this answer is the therapist's synthesis of a консилиум. */
      readonly consilium: AssistantConsilium | null;
      readonly provenance: { readonly modelId: string; readonly runtimeVersion: string };
      /** Owner-only diagnostics; null for a reader. */
      readonly exchanges: readonly AssistantExchange[] | null;
      readonly createdAt: string;
    };

export interface AssistantConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly messageCount: number;
  readonly lastMessageAt: string | null;
  readonly acknowledged: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssistantWorkspaceResponse {
  readonly contractVersion: typeof ASSISTANT_CONTRACT_VERSION;
  readonly profileId: string;
  readonly assistantId: AssistantId;
  readonly canWrite: boolean;
  /** Sex and birth year recorded; without them the assistant answers only with `missing`. */
  readonly interpretationReady: boolean;
  /** How many confirmed observations the assistant will see with the next message. */
  readonly evidenceCount: number;
  /** The same observations, with their sources, so every ref in an answer opens its page. */
  readonly evidence: readonly AssistantEvidenceItem[];
  /** Whom a консилиум would convene right now, and on which observations. */
  readonly consiliumPanel: readonly AssistantInvitation[];
  readonly conversations: readonly AssistantConversationSummary[];
  readonly selectedConversationId: string | null;
  readonly messages: readonly AssistantMessage[];
}

export interface AssistantConversationCreateRequest {
  readonly title: string;
}

export interface AssistantAcknowledgementRequest {
  readonly acknowledgement: typeof ASSISTANT_EGRESS_ACKNOWLEDGEMENT;
}

export interface AssistantMessageRequest {
  readonly message: string;
  /** Ask one specialist persona instead of the therapist. */
  readonly addressee?: AssistantSpecialty;
}

/** Convene the консилиум: the deterministic panel, plus any specialty the person adds. */
export interface AssistantConsiliumRequest {
  readonly question: string | null;
  readonly specialties?: readonly AssistantSpecialty[];
}
