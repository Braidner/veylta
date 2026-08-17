import { randomUUID } from "node:crypto";
import {
  CARE_PLAN_CATEGORIES,
  CARE_PLAN_ITEM_STATES,
  type CarePlanCategory,
  type CarePlanItem,
  type CarePlanItemCreateRequest,
  type CarePlanItemResponse,
  type CarePlanItemState,
  type CarePlanItemStateRequest,
  type CarePlanProposalResponse,
  type CarePlanResponse,
  HOME_CARE_PLAN_CONTRACT_VERSION,
} from "@veylta/contracts";
import type { Database, QueryResult } from "../database/pool.js";
import {
  DomainConflictError,
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import {
  canonicalProfileScope,
  profileAccess,
  requireProfileWrite,
} from "../family/profile-access.js";
import type {
  CarePlanGeneratorEvidence,
  CarePlanGeneratorResult,
  CarePlanProposalGenerator,
} from "./codex-care-plan-generator.js";

export const CODEX_CARE_PLAN_RULE_VERSION = "codex-care-plan/v1" as const;

export class CarePlanProposalGenerationError extends Error {
  readonly code: "CODEX_UNAVAILABLE" | "OUTPUT_INVALID";

  constructor(code: "CODEX_UNAVAILABLE" | "OUTPUT_INVALID") {
    super("Codex care-plan proposal generation failed");
    this.name = "CarePlanProposalGenerationError";
    this.code = code;
  }
}

export interface CarePlanScope {
  familyId: string;
  profileId: string;
}

export interface CarePlanService {
  get(actor: SessionActor, scope: CarePlanScope, correlationId: string): Promise<CarePlanResponse>;
  createItem(
    actor: SessionActor,
    scope: CarePlanScope,
    itemId: string,
    input: CarePlanItemCreateRequest,
    correlationId: string,
  ): Promise<{ created: boolean; response: CarePlanItemResponse }>;
  changeItemState(
    actor: SessionActor,
    scope: CarePlanScope,
    itemId: string,
    input: CarePlanItemStateRequest,
    correlationId: string,
  ): Promise<CarePlanItemResponse>;
  generateProposals(
    actor: SessionActor,
    scope: CarePlanScope,
    correlationId: string,
  ): Promise<CarePlanProposalResponse>;
}

interface Queryable {
  query<T extends object>(sql: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

interface CarePlanItemRow {
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

interface ProposalRunRow {
  id: string;
  health_summary_id: string;
  health_summary_version: number;
  model_id: string;
  runtime_version: string;
  rule_version: string;
  proposal_count: number;
  completed_at: string;
}

interface ProposalSummaryRow {
  id: string;
  version: number;
  missing_data: string;
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const categorySet = new Set<string>(CARE_PLAN_CATEGORIES);
const stateSet = new Set<string>(CARE_PLAN_ITEM_STATES);

function canonicalItemId(value: string): string {
  const id = value.toLowerCase();
  if (!canonicalUuidPattern.test(id)) throw new DomainValidationError();
  return id;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new DomainValidationError();
  }
  return value;
}

function localDate(value: string | null): string | null {
  if (value === null) return null;
  if (!localDatePattern.test(value)) throw new DomainValidationError();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new DomainValidationError();
  }
  return value;
}

function boundedText(value: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) throw new DomainValidationError();
  return normalized;
}

function optionalText(value: string | null, maximum: number): string | null {
  return value === null ? null : boundedText(value, maximum);
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Stored ${label} is invalid`);
  }
  return value;
}

function missingContext(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (item) =>
          typeof item !== "string" ||
          !/^[a-z0-9_]{1,120}$/.test(item) ||
          parsed.indexOf(item) !== parsed.lastIndexOf(item),
      )
    ) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new Error("Stored care plan context is invalid");
  }
}

function storedStringArray(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new Error("Stored health summary context is invalid");
  }
}

function carePlanItem(row: CarePlanItemRow): CarePlanItem {
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
    createdAt,
    updatedAt,
  };
}

async function audit(
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

const itemSelect = `SELECT item.id, item.category, item.title, item.note, item.scheduled_for,
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

async function itemById(
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

function sameCreate(item: CarePlanItem, input: CarePlanItemCreateRequest): boolean {
  return (
    item.origin === "user" &&
    item.category === input.category &&
    item.title === input.title &&
    item.note === input.note &&
    item.scheduledFor === input.scheduledFor
  );
}

function proposalText(category: CarePlanCategory, sourceName: string | null) {
  const source = sourceName === null ? "подтверждённой сводки" : sourceName;
  switch (category) {
    case "laboratory":
      return {
        title: `Обсудить контроль: ${source}`.slice(0, 120),
        note: "Решение о повторном анализе принимает врач после сверки подтверждённого источника.",
      };
    case "clinician":
      return {
        title: "Подготовить подтверждённую сводку для врача",
        note: `Взять источник «${source}» и заранее записать вопросы к приёму.`.slice(0, 500),
      };
    case "nutrition":
      return {
        title: "Собрать контекст о питании для обсуждения",
        note: "Не менять рацион автоматически: сначала уточнить ограничения и обсудить их со специалистом.",
      };
    case "activity":
      return {
        title: "Уточнить ограничения для физической активности",
        note: "Не начинать программу автоматически: сначала подтвердить допустимую нагрузку.",
      };
    case "reminder":
      return {
        title: "Запланировать обсуждение подтверждённой сводки",
        note: "Выберите срок после принятия этого черновика.",
      };
  }
}

function proposalRun(row: ProposalRunRow) {
  return {
    id: canonicalItemId(row.id),
    healthSummary: {
      id: canonicalItemId(row.health_summary_id),
      version: count(row.health_summary_version, "proposal summary version"),
    },
    modelId: boundedText(row.model_id, 80),
    runtimeVersion: boundedText(row.runtime_version, 120),
    ruleVersion: boundedText(row.rule_version, 120),
    proposalCount: count(row.proposal_count, "proposal count"),
    completedAt: timestamp(row.completed_at),
  };
}

async function completedProposalResponse(
  client: Queryable,
  scope: CarePlanScope,
  runId: string,
  replayed: boolean,
): Promise<CarePlanProposalResponse> {
  const row = (
    await client.query<ProposalRunRow>(
      `SELECT run.id, run.health_summary_id, summary.version AS health_summary_version,
              run.model_id, run.runtime_version, run.rule_version, run.proposal_count,
              run.completed_at
         FROM care_plan_proposal_runs run
         JOIN health_summaries summary
           ON summary.family_id = run.family_id AND summary.id = run.health_summary_id
        WHERE run.family_id = $1 AND run.patient_profile_id = $2
          AND run.id = $3 AND run.state = 'completed'`,
      [scope.familyId, scope.profileId, runId],
    )
  ).rows[0];
  if (row === undefined) throw new Error("Completed care-plan proposal run is unavailable");
  const items = await client.query<CarePlanItemRow>(
    `${itemSelect}
      WHERE item.family_id = $1 AND item.patient_profile_id = $2
        AND provenance.proposal_run_id = $3
      ORDER BY item.category, item.id`,
    [scope.familyId, scope.profileId, runId],
  );
  const run = proposalRun(row);
  if (items.rows.length !== run.proposalCount) {
    throw new Error("Stored care-plan proposal count is invalid");
  }
  return {
    contractVersion: HOME_CARE_PLAN_CONTRACT_VERSION,
    profileId: scope.profileId,
    replayed,
    run,
    items: items.rows.map(carePlanItem),
  };
}

export function createCarePlanService(
  database: Database,
  proposals?: { generator: CarePlanProposalGenerator; leaseDurationMs?: number },
): CarePlanService {
  return {
    async get(actor, requestedScope, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      return database.transaction(async (client) => {
        const { canWrite } = await profileAccess(client, actor, scope);
        const evidence = (
          await client.query<{
            source_count: number;
            pending_review_count: number;
            confirmed_observation_count: number;
            summary_id: string | null;
            summary_version: number | null;
            summary_created_at: string | null;
          }>(
            `SELECT
               (SELECT count(*) FROM documents d
                 WHERE d.family_id = $1
                   AND d.patient_profile_id = $2
                   AND d.deleted_at IS NULL) AS source_count,
               (SELECT count(*)
                  FROM extracted_facts fact
                  JOIN extraction_runs run
                    ON run.family_id = fact.family_id AND run.id = fact.extraction_run_id
                  JOIN document_versions version
                    ON version.family_id = run.family_id AND version.id = run.document_version_id
                  JOIN documents document
                    ON document.family_id = version.family_id AND document.id = version.document_id
             LEFT JOIN review_decisions decision
                    ON decision.family_id = fact.family_id
                   AND decision.extracted_fact_id = fact.id
                 WHERE document.family_id = $1
                   AND document.patient_profile_id = $2
                   AND document.deleted_at IS NULL
                   AND decision.id IS NULL) AS pending_review_count,
               (SELECT count(*) FROM observations observation
                 WHERE observation.family_id = $1
                   AND observation.patient_profile_id = $2
                   AND observation.status = 'confirmed') AS confirmed_observation_count,
               summary.id AS summary_id,
               summary.version AS summary_version,
               summary.created_at AS summary_created_at
              FROM patient_profiles profile
         LEFT JOIN health_summaries summary
                ON summary.family_id = profile.family_id
               AND summary.patient_profile_id = profile.id
               AND summary.version = (
                 SELECT max(latest.version)
                   FROM health_summaries latest
                  WHERE latest.family_id = profile.family_id
                    AND latest.patient_profile_id = profile.id
               )
             WHERE profile.family_id = $1 AND profile.id = $2`,
            [scope.familyId, scope.profileId],
          )
        ).rows[0];
        if (evidence === undefined) throw new ResourceNotFoundError();
        const items = await client.query<CarePlanItemRow>(
          `${itemSelect}
           WHERE item.family_id = $1 AND item.patient_profile_id = $2
           ORDER BY CASE item.state
                      WHEN 'proposed' THEN 0
                      WHEN 'accepted' THEN 1
                      WHEN 'completed' THEN 2
                      ELSE 3
                    END,
                    CASE WHEN item.scheduled_for IS NULL THEN 1 ELSE 0 END,
                    item.scheduled_for,
                    item.created_at DESC,
                    item.id DESC`,
          [scope.familyId, scope.profileId],
        );
        const now = new Date();
        await audit(client, {
          actor,
          scope,
          action: "profile.care_plan.opened",
          resourceType: "PatientProfile",
          resourceId: scope.profileId,
          correlationId,
          now,
        });
        return {
          contractVersion: HOME_CARE_PLAN_CONTRACT_VERSION,
          profileId: scope.profileId,
          canWrite,
          evidence: {
            sourceCount: count(evidence.source_count, "care plan source count"),
            pendingReviewCount: count(evidence.pending_review_count, "care plan pending count"),
            confirmedObservationCount: count(
              evidence.confirmed_observation_count,
              "care plan observation count",
            ),
            latestSummary:
              evidence.summary_id === null
                ? null
                : {
                    id: canonicalItemId(evidence.summary_id),
                    version: count(evidence.summary_version ?? -1, "care plan summary version"),
                    createdAt: timestamp(evidence.summary_created_at ?? ""),
                  },
          },
          items: items.rows.map(carePlanItem),
        };
      });
    },

    async createItem(actor, requestedScope, requestedItemId, requestedInput, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const itemId = canonicalItemId(requestedItemId);
      if (!categorySet.has(requestedInput.category)) throw new DomainValidationError();
      const input: CarePlanItemCreateRequest = {
        category: requestedInput.category,
        title: boundedText(requestedInput.title, 120),
        note: optionalText(requestedInput.note, 500),
        scheduledFor: localDate(requestedInput.scheduledFor),
      };
      return database.transaction(async (client) => {
        await requireProfileWrite(client, actor, scope);
        const existing = await itemById(client, scope, itemId);
        const now = new Date();
        if (existing !== undefined) {
          const item = carePlanItem(existing);
          if (!sameCreate(item, input)) throw new DomainConflictError();
          await audit(client, {
            actor,
            scope,
            action: "profile.care_plan.item_replayed",
            resourceType: "CarePlanItem",
            resourceId: itemId,
            correlationId,
            now,
          });
          return {
            created: false,
            response: {
              contractVersion: HOME_CARE_PLAN_CONTRACT_VERSION,
              profileId: scope.profileId,
              item,
            },
          };
        }
        await client.query(
          `INSERT INTO care_plan_items
             (id, family_id, patient_profile_id, category, title, note, scheduled_for,
              state, origin, revision, created_by_user_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'accepted', 'user', 1, $8, $9, $9)`,
          [
            itemId,
            scope.familyId,
            scope.profileId,
            input.category,
            input.title,
            input.note,
            input.scheduledFor,
            actor.userId,
            now,
          ],
        );
        const stored = await itemById(client, scope, itemId);
        if (stored === undefined) throw new Error("Created care plan item is unavailable");
        await audit(client, {
          actor,
          scope,
          action: "profile.care_plan.item_created",
          resourceType: "CarePlanItem",
          resourceId: itemId,
          correlationId,
          now,
        });
        return {
          created: true,
          response: {
            contractVersion: HOME_CARE_PLAN_CONTRACT_VERSION,
            profileId: scope.profileId,
            item: carePlanItem(stored),
          },
        };
      });
    },

    async changeItemState(actor, requestedScope, requestedItemId, requestedInput, correlationId) {
      const scope = canonicalProfileScope(requestedScope);
      const itemId = canonicalItemId(requestedItemId);
      if (
        !Number.isSafeInteger(requestedInput.revision) ||
        requestedInput.revision < 1 ||
        !["accepted", "completed", "dismissed"].includes(requestedInput.state)
      ) {
        throw new DomainValidationError();
      }
      const input = {
        revision: requestedInput.revision,
        state: requestedInput.state,
        scheduledFor: localDate(requestedInput.scheduledFor),
      } as const;
      return database.transaction(async (client) => {
        await requireProfileWrite(client, actor, scope);
        const existing = await itemById(client, scope, itemId);
        if (existing === undefined) throw new ResourceNotFoundError();
        const before = carePlanItem(existing);
        const now = new Date();
        if (
          before.revision === input.revision + 1 &&
          before.state === input.state &&
          before.scheduledFor === input.scheduledFor
        ) {
          await audit(client, {
            actor,
            scope,
            action: "profile.care_plan.state_replayed",
            resourceType: "CarePlanItem",
            resourceId: itemId,
            correlationId,
            now,
          });
          return {
            contractVersion: HOME_CARE_PLAN_CONTRACT_VERSION,
            profileId: scope.profileId,
            item: before,
          };
        }
        if (before.revision !== input.revision) throw new DomainConflictError();
        const transitionAllowed =
          (before.state === "proposed" && ["accepted", "dismissed"].includes(input.state)) ||
          (before.state === "accepted" &&
            ["accepted", "completed", "dismissed"].includes(input.state));
        if (!transitionAllowed) throw new DomainConflictError();
        const updated = await client.query(
          `UPDATE care_plan_items
              SET state = $1, scheduled_for = $2, revision = revision + 1, updated_at = $3
            WHERE family_id = $4 AND patient_profile_id = $5 AND id = $6 AND revision = $7`,
          [
            input.state,
            input.scheduledFor,
            now,
            scope.familyId,
            scope.profileId,
            itemId,
            input.revision,
          ],
        );
        if (updated.rowCount !== 1) throw new DomainConflictError();
        const stored = await itemById(client, scope, itemId);
        if (stored === undefined) throw new Error("Updated care plan item is unavailable");
        await audit(client, {
          actor,
          scope,
          action: `profile.care_plan.item_${input.state}`,
          resourceType: "CarePlanItem",
          resourceId: itemId,
          correlationId,
          now,
        });
        return {
          contractVersion: HOME_CARE_PLAN_CONTRACT_VERSION,
          profileId: scope.profileId,
          item: carePlanItem(stored),
        };
      });
    },

    async generateProposals(actor, requestedScope, correlationId) {
      if (proposals === undefined) throw new CarePlanProposalGenerationError("CODEX_UNAVAILABLE");
      const executionProfile = await proposals.generator.executionProfile();
      const scope = canonicalProfileScope(requestedScope);
      const leaseDurationMs = proposals.leaseDurationMs ?? 180_000;
      const claimed = await database.transaction(async (client) => {
        await requireProfileWrite(client, actor, scope);
        const summary = (
          await client.query<ProposalSummaryRow>(
            `SELECT id, version, missing_data
               FROM health_summaries
              WHERE family_id = $1 AND patient_profile_id = $2
              ORDER BY version DESC LIMIT 1`,
            [scope.familyId, scope.profileId],
          )
        ).rows[0];
        if (summary === undefined) throw new DomainConflictError();
        const existing = (
          await client.query<{ id: string; state: string; lease_expires_at: string | null }>(
            `SELECT id, state, lease_expires_at
               FROM care_plan_proposal_runs
              WHERE family_id = $1 AND patient_profile_id = $2 AND health_summary_id = $3
                AND model_id = $4 AND rule_version = $5`,
            [
              scope.familyId,
              scope.profileId,
              summary.id,
              executionProfile.modelId,
              CODEX_CARE_PLAN_RULE_VERSION,
            ],
          )
        ).rows[0];
        if (existing?.state === "completed") {
          return { kind: "replay" as const, runId: existing.id };
        }
        const now = new Date();
        const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
        let runId = existing?.id;
        if (existing?.state === "generating") {
          if (
            existing.lease_expires_at === null ||
            new Date(existing.lease_expires_at).getTime() > now.getTime()
          ) {
            throw new DomainConflictError();
          }
          await client.query(
            `UPDATE care_plan_proposal_runs
                SET state = 'failed', failure_code = 'CODEX_UNAVAILABLE',
                    lease_expires_at = NULL, updated_at = $1
              WHERE family_id = $2 AND id = $3 AND state = 'generating'`,
            [now, scope.familyId, existing.id],
          );
        }
        if (runId === undefined) {
          runId = randomUUID();
          await client.query(
            `INSERT INTO care_plan_proposal_runs
               (id, family_id, patient_profile_id, health_summary_id, requested_by_user_id,
                model_id, rule_version, state, attempt_count, lease_expires_at,
                created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'generating', 1, $8, $9, $9)`,
            [
              runId,
              scope.familyId,
              scope.profileId,
              summary.id,
              actor.userId,
              executionProfile.modelId,
              CODEX_CARE_PLAN_RULE_VERSION,
              leaseExpiresAt,
              now,
            ],
          );
        } else {
          const reclaimed = await client.query(
            `UPDATE care_plan_proposal_runs
                SET state = 'generating', attempt_count = attempt_count + 1,
                    lease_expires_at = $1, failure_code = NULL, updated_at = $2
              WHERE family_id = $3 AND id = $4 AND state = 'failed'`,
            [leaseExpiresAt, now, scope.familyId, runId],
          );
          if (reclaimed.rowCount !== 1) throw new DomainConflictError();
        }
        const evidence = await client.query<{
          observation_id: string;
          source_name: string;
          source_value: string;
          source_unit: string;
          canonical_code: string | null;
          sampled_at: string | null;
          resulted_at: string | null;
          laboratory: string | null;
          position: number;
        }>(
          `SELECT evidence.observation_id, evidence.position,
                  observation.source_name, observation.source_value, observation.source_unit,
                  observation.canonical_code, observation.sampled_at, observation.resulted_at,
                  observation.laboratory
             FROM health_summary_evidence evidence
             JOIN observations observation
               ON observation.family_id = evidence.family_id
              AND observation.id = evidence.observation_id
            WHERE evidence.family_id = $1 AND evidence.health_summary_id = $2
            ORDER BY evidence.position`,
          [scope.familyId, summary.id],
        );
        const values: CarePlanGeneratorEvidence[] = evidence.rows.map((row, index) => {
          if (row.position !== index + 1) throw new Error("Stored proposal evidence is invalid");
          return {
            index,
            observationId: canonicalItemId(row.observation_id),
            sourceName: boundedText(row.source_name, 200),
            sourceValue: boundedText(row.source_value, 100),
            sourceUnit: boundedText(row.source_unit, 100),
            canonicalCode: row.canonical_code,
            sampledAt: row.sampled_at,
            resultedAt: row.resulted_at,
            laboratory: row.laboratory,
          };
        });
        return {
          kind: "generate" as const,
          runId,
          summary: {
            id: canonicalItemId(summary.id),
            version: count(summary.version, "proposal summary version"),
            missingData: storedStringArray(summary.missing_data),
          },
          evidence: values,
        };
      });
      if (claimed.kind === "replay") {
        return database.transaction(async (client) => {
          await requireProfileWrite(client, actor, scope);
          const response = await completedProposalResponse(client, scope, claimed.runId, true);
          await audit(client, {
            actor,
            scope,
            action: "profile.care_plan.proposals_replayed",
            resourceType: "PatientProfile",
            resourceId: scope.profileId,
            correlationId,
            now: new Date(),
          });
          return response;
        });
      }
      let generated: CarePlanGeneratorResult;
      try {
        generated = await proposals.generator.generate(
          {
            healthSummary: claimed.summary,
            evidence: claimed.evidence,
          },
          executionProfile,
        );
        if (generated.modelId !== executionProfile.modelId) {
          throw new Error("Codex proposal model is invalid");
        }
      } catch (error) {
        const code = /invalid/i.test(error instanceof Error ? error.message : "")
          ? "OUTPUT_INVALID"
          : "CODEX_UNAVAILABLE";
        await database.transaction(async (client) => {
          await client.query(
            `UPDATE care_plan_proposal_runs
                SET state = 'failed', failure_code = $1, lease_expires_at = NULL, updated_at = $2
              WHERE family_id = $3 AND id = $4 AND state = 'generating'`,
            [code, new Date(), scope.familyId, claimed.runId],
          );
          await audit(client, {
            actor,
            scope,
            action: "profile.care_plan.proposals_failed",
            resourceType: "PatientProfile",
            resourceId: scope.profileId,
            correlationId,
            now: new Date(),
          });
        });
        throw new CarePlanProposalGenerationError(code);
      }
      const persisted = await database.transaction(async (client) => {
        await requireProfileWrite(client, actor, scope);
        const currentSummary = (
          await client.query<{ id: string }>(
            `SELECT id FROM health_summaries
              WHERE family_id = $1 AND patient_profile_id = $2
              ORDER BY version DESC LIMIT 1`,
            [scope.familyId, scope.profileId],
          )
        ).rows[0];
        if (currentSummary?.id !== claimed.summary.id) {
          const now = new Date();
          await client.query(
            `UPDATE care_plan_proposal_runs
                SET state = 'failed', failure_code = 'SUMMARY_CHANGED',
                    lease_expires_at = NULL, updated_at = $1
              WHERE family_id = $2 AND id = $3 AND state = 'generating'`,
            [now, scope.familyId, claimed.runId],
          );
          await audit(client, {
            actor,
            scope,
            action: "profile.care_plan.proposals_failed",
            resourceType: "PatientProfile",
            resourceId: scope.profileId,
            correlationId,
            now,
          });
          return null;
        }
        const active = await client.query<{ id: string }>(
          `SELECT id FROM care_plan_proposal_runs
            WHERE family_id = $1 AND patient_profile_id = $2 AND id = $3
              AND state = 'generating' AND lease_expires_at > $4`,
          [scope.familyId, scope.profileId, claimed.runId, new Date()],
        );
        if (active.rows[0] === undefined) throw new DomainConflictError();
        const now = new Date();
        for (const proposal of generated.items) {
          const itemId = randomUUID();
          const source =
            proposal.sourceObservationIndex === null
              ? null
              : claimed.evidence[proposal.sourceObservationIndex];
          if (proposal.sourceObservationIndex !== null && source === undefined) {
            throw new CarePlanProposalGenerationError("OUTPUT_INVALID");
          }
          const copy = proposalText(proposal.category, source?.sourceName ?? null);
          await client.query(
            `INSERT INTO care_plan_codex_provenance
               (family_id, patient_profile_id, care_plan_item_id, proposal_run_id,
                category, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [scope.familyId, scope.profileId, itemId, claimed.runId, proposal.category, now],
          );
          await client.query(
            `INSERT INTO care_plan_items
               (id, family_id, patient_profile_id, category, title, note, scheduled_for,
                state, origin, revision, created_by_user_id, health_summary_id,
                source_observation_id, rule_version, missing_context, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NULL, 'proposed', 'codex', 1, $7, $8,
                     $9, $10, $11, $12, $12)`,
            [
              itemId,
              scope.familyId,
              scope.profileId,
              proposal.category,
              copy.title,
              copy.note,
              actor.userId,
              claimed.summary.id,
              source?.observationId ?? null,
              CODEX_CARE_PLAN_RULE_VERSION,
              [...proposal.missingContext].sort(),
              now,
            ],
          );
        }
        const completed = await client.query(
          `UPDATE care_plan_proposal_runs
              SET state = 'completed', runtime_version = $1, proposal_count = $2,
                  lease_expires_at = NULL, completed_at = $3, updated_at = $3
            WHERE family_id = $4 AND id = $5 AND state = 'generating'`,
          [generated.runtimeVersion, generated.items.length, now, scope.familyId, claimed.runId],
        );
        if (completed.rowCount !== 1) throw new DomainConflictError();
        await audit(client, {
          actor,
          scope,
          action: "profile.care_plan.proposals_completed",
          resourceType: "PatientProfile",
          resourceId: scope.profileId,
          correlationId,
          now,
        });
        return completedProposalResponse(client, scope, claimed.runId, false);
      });
      if (persisted === null) throw new DomainConflictError();
      return persisted;
    },
  };
}
