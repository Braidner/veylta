/** The household care plan: lanes, items and Codex proposal provenance. */
export const HOME_CARE_PLAN_CONTRACT_VERSION = "home-care-plan/v1" as const;
export const CARE_PLAN_CATEGORIES = [
  "laboratory",
  "clinician",
  "nutrition",
  "activity",
  "reminder",
] as const;
export const CARE_PLAN_ITEM_STATES = ["proposed", "accepted", "completed", "dismissed"] as const;

export type CarePlanCategory = (typeof CARE_PLAN_CATEGORIES)[number];
export type CarePlanItemState = (typeof CARE_PLAN_ITEM_STATES)[number];

/**
 * Source binding for an agent/rule proposal. User-authored actions have null
 * provenance and are never presented as source-derived recommendations.
 */
export interface CarePlanProvenance {
  readonly proposalRunId: string;
  readonly healthSummary: {
    readonly id: string;
    readonly version: number;
  };
  readonly sourceObservationId: string | null;
  readonly modelId: string;
  readonly runtimeVersion: string;
  readonly ruleVersion: string;
  readonly missingContext: readonly string[];
}

export interface CarePlanItem {
  readonly id: string;
  readonly category: CarePlanCategory;
  readonly title: string;
  readonly note: string | null;
  readonly scheduledFor: string | null;
  readonly state: CarePlanItemState;
  readonly origin: "user" | "codex";
  readonly revision: number;
  readonly provenance: CarePlanProvenance | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CarePlanResponse {
  readonly contractVersion: typeof HOME_CARE_PLAN_CONTRACT_VERSION;
  readonly profileId: string;
  readonly canWrite: boolean;
  readonly evidence: {
    readonly sourceCount: number;
    readonly pendingReviewCount: number;
    readonly confirmedObservationCount: number;
    readonly latestSummary: {
      readonly id: string;
      readonly version: number;
      readonly createdAt: string;
    } | null;
  };
  readonly items: readonly CarePlanItem[];
}

export interface CarePlanItemCreateRequest {
  readonly category: CarePlanCategory;
  readonly title: string;
  readonly note: string | null;
  /** Local calendar date in canonical YYYY-MM-DD form. */
  readonly scheduledFor: string | null;
}

export interface CarePlanItemStateRequest {
  readonly revision: number;
  readonly state: "accepted" | "completed" | "dismissed";
  readonly scheduledFor: string | null;
}

export interface CarePlanItemResponse {
  readonly contractVersion: typeof HOME_CARE_PLAN_CONTRACT_VERSION;
  readonly profileId: string;
  readonly item: CarePlanItem;
}

export interface CarePlanProposalRequest {
  /** Explicit acknowledgement that the confirmed summary is sent to the Codex model service. */
  readonly acknowledgement: "send_confirmed_summary_to_codex";
}

export interface CarePlanProposalRun {
  readonly id: string;
  readonly healthSummary: {
    readonly id: string;
    readonly version: number;
  };
  readonly modelId: string;
  readonly runtimeVersion: string;
  readonly ruleVersion: string;
  readonly proposalCount: number;
  readonly completedAt: string;
}

export interface CarePlanProposalResponse {
  readonly contractVersion: typeof HOME_CARE_PLAN_CONTRACT_VERSION;
  readonly profileId: string;
  /** True when the exact summary/model/rule result was already stored. */
  readonly replayed: boolean;
  readonly run: CarePlanProposalRun;
  readonly items: readonly CarePlanItem[];
}
