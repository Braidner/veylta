/** The household care plan: lanes, items, the person's own check-ins and Codex proposal provenance. */
export const HOME_CARE_PLAN_CONTRACT_VERSION = "home-care-plan/v2" as const;
export const CARE_PLAN_CATEGORIES = [
  "laboratory",
  "clinician",
  "nutrition",
  "activity",
  "reminder",
] as const;
export const CARE_PLAN_ITEM_STATES = ["proposed", "accepted", "completed", "dismissed"] as const;
/** The lanes whose accepted items are a regimen the person keeps day by day. */
export const CARE_PLAN_CHECKIN_CATEGORIES = ["activity", "nutrition"] as const;
export const CARE_PLAN_CHECKIN_STATUSES = ["done", "skipped"] as const;
/** How far back the plan carries check-ins — the window the assistants read adherence over. */
export const CARE_PLAN_CHECKIN_DAYS = 28;
export const MAX_CARE_PLAN_CHECKIN_NOTE_LENGTH = 200;

export type CarePlanCategory = (typeof CARE_PLAN_CATEGORIES)[number];
export type CarePlanItemState = (typeof CARE_PLAN_ITEM_STATES)[number];
export type CarePlanCheckinCategory = (typeof CARE_PLAN_CHECKIN_CATEGORIES)[number];
export type CarePlanCheckinStatus = (typeof CARE_PLAN_CHECKIN_STATUSES)[number];

/**
 * One day of an accepted regimen item as the person marked it: done or skipped, with a note in
 * their own words. One per item and day; a later mark for the same day replaces the earlier.
 */
export interface CarePlanCheckin {
  /** Local calendar date in canonical YYYY-MM-DD form, chosen by the person's browser. */
  readonly date: string;
  readonly status: CarePlanCheckinStatus;
  readonly note: string | null;
  readonly recordedAt: string;
}

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
  /** The last `CARE_PLAN_CHECKIN_DAYS` of marks, oldest first; empty outside the regimen lanes. */
  readonly checkins: readonly CarePlanCheckin[];
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

/** `PUT …/items/:itemId/checkins/:date` — the mark for one day of an accepted regimen item. */
export interface CarePlanCheckinRequest {
  readonly status: CarePlanCheckinStatus;
  readonly note: string | null;
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
