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
  created_at: string;
  updated_at: string;
}

const canonicalUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const categorySet = new Set<string>(CARE_PLAN_CATEGORIES);
const stateSet = new Set<string>(CARE_PLAN_ITEM_STATES);

function canonicalScope(scope: CarePlanScope): CarePlanScope {
  const familyId = scope.familyId.toLowerCase();
  const profileId = scope.profileId.toLowerCase();
  if (!canonicalUuidPattern.test(familyId) || !canonicalUuidPattern.test(profileId)) {
    throw new DomainValidationError();
  }
  return { familyId, profileId };
}

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
            row.rule_version.length === 0 ||
            row.rule_version.length > 120 ||
            (row.source_observation_id !== null &&
              !canonicalUuidPattern.test(row.source_observation_id))
          ) {
            throw new Error("Stored proposed care plan item is invalid");
          }
          return {
            healthSummary: { id: row.health_summary_id, version: row.health_summary_version },
            sourceObservationId: row.source_observation_id,
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

async function access(
  client: Queryable,
  actor: SessionActor,
  scope: CarePlanScope,
): Promise<{ canWrite: boolean }> {
  const result = await client.query<{ can_write: number }>(
    `SELECT CASE
              WHEN m.role = 'owner'
                OR (m.role = 'adult_member' AND p.linked_user_id = m.user_id)
              THEN 1 ELSE 0
            END AS can_write
       FROM patient_profiles p
       JOIN family_memberships m
         ON m.family_id = p.family_id
        AND m.user_id = $3
        AND m.status = 'active'
      WHERE p.family_id = $1
        AND p.id = $2
        AND p.archived_at IS NULL
        AND (
          m.role = 'owner'
          OR (m.role = 'adult_member' AND p.linked_user_id = m.user_id)
          OR (
            m.role IN ('adult_member', 'caregiver')
            AND EXISTS (
              SELECT 1
                FROM profile_consent_grants grant_access
               WHERE grant_access.family_id = p.family_id
                 AND grant_access.patient_profile_id = p.id
                 AND grant_access.grantee_user_id = m.user_id
                 AND grant_access.capability = 'profile.read'
                 AND grant_access.revoked_at IS NULL
            )
          )
        )`,
    [scope.familyId, scope.profileId, actor.userId],
  );
  const row = result.rows[0];
  if (row === undefined || ![0, 1].includes(row.can_write)) throw new ResourceNotFoundError();
  return { canWrite: row.can_write === 1 };
}

async function requireWrite(
  client: Queryable,
  actor: SessionActor,
  scope: CarePlanScope,
): Promise<void> {
  if (!(await access(client, actor, scope)).canWrite) throw new ResourceNotFoundError();
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
                           item.created_at, item.updated_at
                      FROM care_plan_items item
                 LEFT JOIN health_summaries summary
                        ON summary.family_id = item.family_id
                       AND summary.id = item.health_summary_id`;

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

export function createCarePlanService(database: Database): CarePlanService {
  return {
    async get(actor, requestedScope, correlationId) {
      const scope = canonicalScope(requestedScope);
      return database.transaction(async (client) => {
        const { canWrite } = await access(client, actor, scope);
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
                 WHERE d.family_id = $1 AND d.patient_profile_id = $2) AS source_count,
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
      const scope = canonicalScope(requestedScope);
      const itemId = canonicalItemId(requestedItemId);
      if (!categorySet.has(requestedInput.category)) throw new DomainValidationError();
      const input: CarePlanItemCreateRequest = {
        category: requestedInput.category,
        title: boundedText(requestedInput.title, 120),
        note: optionalText(requestedInput.note, 500),
        scheduledFor: localDate(requestedInput.scheduledFor),
      };
      return database.transaction(async (client) => {
        await requireWrite(client, actor, scope);
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
      const scope = canonicalScope(requestedScope);
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
        await requireWrite(client, actor, scope);
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
  };
}
