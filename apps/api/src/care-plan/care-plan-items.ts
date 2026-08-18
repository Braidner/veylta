import { randomUUID } from "node:crypto";
import {
  type CarePlanCategory,
  type CarePlanCheckin,
  type CarePlanItem,
  type CarePlanItemState,
  HOME_CARE_PLAN_CONTRACT_VERSION,
} from "@veylta/contracts";
import type { QueryResult } from "../database/pool.js";
import type { SessionActor } from "../family/family-service.js";
import {
  boundedText,
  canonicalUuidPattern,
  categorySet,
  localDate,
  missingContext,
  optionalText,
  stateSet,
  timestamp,
} from "./care-plan-fields.js";

/** One profile's plan, as the routes address it. */
export interface CarePlanScope {
  familyId: string;
  profileId: string;
}

export interface Queryable {
  query<T extends object>(sql: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface CarePlanItemRow {
  id: string;
  category: string;
  title: string;
  note: string | null;
  scheduled_for: string | null;
  state: string;
  origin: string;
  revision: number;
  health_summary_id: string | null;
  health_summary_version: number | null;
  source_observation_id: string | null;
  rule_version: string | null;
  missing_context: string;
  proposal_run_id: string | null;
  proposal_model_id: string | null;
  proposal_run_state: string | null;
  proposal_runtime_version: string | null;
  created_at: string;
  updated_at: string;
}

export function carePlanItem(
  row: CarePlanItemRow,
  checkins: readonly CarePlanCheckin[] = [],
): CarePlanItem {
  if (
    !canonicalUuidPattern.test(row.id) ||
    !categorySet.has(row.category) ||
    !stateSet.has(row.state) ||
    !["user", "codex"].includes(row.origin) ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1
  ) {
    throw new Error("Stored care plan item is invalid");
  }
  const title = boundedText(row.title, 120);
  const note = optionalText(row.note, 500);
  const scheduledFor = localDate(row.scheduled_for);
  const createdAt = timestamp(row.created_at);
  const updatedAt = timestamp(row.updated_at);
  const context = missingContext(row.missing_context);
  const provenance =
    row.origin === "user"
      ? (() => {
          if (
            row.proposal_run_id !== null ||
            row.proposal_model_id !== null ||
            row.proposal_run_state !== null ||
            row.proposal_runtime_version !== null ||
            row.health_summary_id !== null ||
            row.health_summary_version !== null ||
            row.source_observation_id !== null ||
            row.rule_version !== null ||
            context.length !== 0 ||
            row.state === "proposed"
          ) {
            throw new Error("Stored user care plan item is invalid");
          }
          return null;
        })()
      : (() => {
          if (
            row.health_summary_id === null ||
            !canonicalUuidPattern.test(row.health_summary_id) ||
            row.health_summary_version === null ||
            !Number.isSafeInteger(row.health_summary_version) ||
            row.health_summary_version < 1 ||
            row.rule_version === null ||
            row.proposal_run_id === null ||
            !canonicalUuidPattern.test(row.proposal_run_id) ||
            row.proposal_model_id === null ||
            !/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(row.proposal_model_id) ||
            row.proposal_run_state !== "completed" ||
            row.proposal_runtime_version === null ||
            row.proposal_runtime_version.length === 0 ||
            row.proposal_runtime_version.length > 120 ||
            row.rule_version.length === 0 ||
            row.rule_version.length > 120 ||
            (row.source_observation_id !== null &&
              !canonicalUuidPattern.test(row.source_observation_id))
          ) {
            throw new Error("Stored proposed care plan item is invalid");
          }
          return {
            proposalRunId: row.proposal_run_id,
            healthSummary: { id: row.health_summary_id, version: row.health_summary_version },
            sourceObservationId: row.source_observation_id,
            modelId: row.proposal_model_id,
            runtimeVersion: row.proposal_runtime_version,
            ruleVersion: row.rule_version,
            missingContext: context,
          };
        })();

  return {
    id: row.id,
    category: row.category as CarePlanCategory,
    title,
    note,
    scheduledFor,
    state: row.state as CarePlanItemState,
    origin: row.origin as "user" | "codex",
    revision: row.revision,
    provenance,
    checkins,
    createdAt,
    updatedAt,
  };
}

export const itemSelect = `SELECT item.id, item.category, item.title, item.note, item.scheduled_for,
                           item.state, item.origin, item.revision, item.health_summary_id,
                           summary.version AS health_summary_version,
                           item.source_observation_id, item.rule_version, item.missing_context,
                           provenance.proposal_run_id,
                           proposal_run.model_id AS proposal_model_id,
                           proposal_run.state AS proposal_run_state,
                           proposal_run.runtime_version AS proposal_runtime_version,
                           item.created_at, item.updated_at
                      FROM care_plan_items item
                 LEFT JOIN health_summaries summary
                        ON summary.family_id = item.family_id
                       AND summary.id = item.health_summary_id
                 LEFT JOIN care_plan_codex_provenance provenance
                        ON provenance.family_id = item.family_id
                       AND provenance.patient_profile_id = item.patient_profile_id
                       AND provenance.care_plan_item_id = item.id
                 LEFT JOIN care_plan_proposal_runs proposal_run
                        ON proposal_run.family_id = provenance.family_id
                       AND proposal_run.patient_profile_id = provenance.patient_profile_id
                       AND proposal_run.id = provenance.proposal_run_id`;

export async function itemById(
  client: Queryable,
  scope: CarePlanScope,
  itemId: string,
): Promise<CarePlanItemRow | undefined> {
  return (
    await client.query<CarePlanItemRow>(
      `${itemSelect}
       WHERE item.family_id = $1 AND item.patient_profile_id = $2 AND item.id = $3`,
      [scope.familyId, scope.profileId, itemId],
    )
  ).rows[0];
}

/** A payload-free trail row: actor, plan scope, action, item — never a title or a note. */
export async function auditCarePlan(
  client: Queryable,
  input: {
    actor: SessionActor;
    scope: CarePlanScope;
    action: string;
    resourceType: "CarePlanItem" | "PatientProfile";
    resourceId: string;
    correlationId: string;
    now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (id, family_id, actor_user_id, action, resource_type, resource_id, result,
        correlation_id, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'success', $7, $8, $9)`,
    [
      randomUUID(),
      input.scope.familyId,
      input.actor.userId,
      input.action,
      input.resourceType,
      input.resourceId,
      input.correlationId,
      { contractVersion: HOME_CARE_PLAN_CONTRACT_VERSION },
      input.now,
    ],
  );
}
