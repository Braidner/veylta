import { randomUUID } from "node:crypto";
import {
  CARE_PLAN_CHECKIN_CATEGORIES,
  CARE_PLAN_CHECKIN_DAYS,
  CARE_PLAN_CHECKIN_STATUSES,
  type CarePlanCheckin,
  type CarePlanCheckinRequest,
  type CarePlanCheckinStatus,
  type CarePlanItem,
  type CarePlanItemResponse,
  HOME_CARE_PLAN_CONTRACT_VERSION,
  MAX_CARE_PLAN_CHECKIN_NOTE_LENGTH,
} from "@veylta/contracts";
import type { Database } from "../database/pool.js";
import {
  DomainConflictError,
  DomainValidationError,
  ResourceNotFoundError,
  type SessionActor,
} from "../family/family-service.js";
import { canonicalProfileScope, requireProfileWrite } from "../family/profile-access.js";
import { canonicalItemId, localDate, optionalText, timestamp } from "./care-plan-fields.js";
import {
  auditCarePlan,
  type CarePlanItemRow,
  type CarePlanScope,
  carePlanItem,
  itemById,
  type Queryable,
} from "./care-plan-items.js";

interface CheckinRow {
  care_plan_item_id: string;
  checkin_date: string;
  status: string;
  note: string | null;
  recorded_at: string;
}

const checkinStatusSet = new Set<string>(CARE_PLAN_CHECKIN_STATUSES);

/** The first day the plan still shows and the assistants still read: today less the window. */
export function checkinWindowStart(now: Date): string {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - (CARE_PLAN_CHECKIN_DAYS - 1));
  return start.toISOString().slice(0, 10);
}

/** The person's marks inside the window, oldest first, grouped by item. */
export async function checkinsByItem(
  client: Queryable,
  scope: CarePlanScope,
  now: Date,
  itemId?: string,
): Promise<Map<string, CarePlanCheckin[]>> {
  const rows = await client.query<CheckinRow>(
    `SELECT care_plan_item_id, checkin_date, status, note, recorded_at
       FROM care_plan_item_checkins
      WHERE family_id = $1 AND patient_profile_id = $2 AND checkin_date >= $3
        ${itemId === undefined ? "" : "AND care_plan_item_id = $4"}
      ORDER BY checkin_date, rowid`,
    itemId === undefined
      ? [scope.familyId, scope.profileId, checkinWindowStart(now)]
      : [scope.familyId, scope.profileId, checkinWindowStart(now), itemId],
  );
  const byItem = new Map<string, CarePlanCheckin[]>();
  for (const row of rows.rows) {
    if (!checkinStatusSet.has(row.status)) throw new Error("Stored care plan check-in is invalid");
    const list = byItem.get(row.care_plan_item_id) ?? [];
    list.push({
      date: localDate(row.checkin_date) ?? "",
      status: row.status as CarePlanCheckinStatus,
      note: optionalText(row.note, 200),
      recordedAt: timestamp(row.recorded_at),
    });
    byItem.set(row.care_plan_item_id, list);
  }
  return byItem;
}

/** One item with its marks — what every item response carries. */
export async function itemWithCheckins(
  client: Queryable,
  scope: CarePlanScope,
  row: CarePlanItemRow,
  now: Date,
): Promise<CarePlanItem> {
  return carePlanItem(row, (await checkinsByItem(client, scope, now, row.id)).get(row.id) ?? []);
}

/** How far back a mark may be entered; the diary is kept, not reconstructed. */
const backfillDays = 60;
const regimenCategories = new Set<string>(CARE_PLAN_CHECKIN_CATEGORIES);
const statuses = new Set<string>(CARE_PLAN_CHECKIN_STATUSES);

/** A day the person may still mark: not older than the backfill window, not past tomorrow. */
function markableDate(value: string, now: Date): string {
  const date = localDate(value);
  if (date === null) throw new DomainValidationError();
  const earliest = new Date(now);
  earliest.setUTCDate(earliest.getUTCDate() - backfillDays);
  const latest = new Date(now);
  latest.setUTCDate(latest.getUTCDate() + 1);
  if (date < earliest.toISOString().slice(0, 10) || date > latest.toISOString().slice(0, 10)) {
    throw new DomainValidationError();
  }
  return date;
}

/**
 * The person's mark for one day of an accepted regimen item. One row per item and day: the same
 * day again replaces the earlier mark (201 the first time, 200 after). A lane outside the regimen
 * ones is a 422, an item no longer accepted a 409, an unauthorised profile a 404 — never a hint.
 */
export async function recordCheckin(
  database: Database,
  input: {
    actor: SessionActor;
    scope: CarePlanScope;
    itemId: string;
    date: string;
    input: CarePlanCheckinRequest;
    correlationId: string;
  },
): Promise<{ created: boolean; response: CarePlanItemResponse }> {
  const scope = canonicalProfileScope(input.scope);
  const itemId = canonicalItemId(input.itemId);
  const now = new Date();
  const date = markableDate(input.date, now);
  if (!statuses.has(input.input.status)) throw new DomainValidationError();
  const note = optionalText(input.input.note, MAX_CARE_PLAN_CHECKIN_NOTE_LENGTH);
  return database.transaction(async (client) => {
    await requireProfileWrite(client, input.actor, scope);
    const item = await itemById(client, scope, itemId);
    if (item === undefined) throw new ResourceNotFoundError();
    if (!regimenCategories.has(item.category)) throw new DomainValidationError();
    if (item.state !== "accepted") throw new DomainConflictError();
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM care_plan_item_checkins
        WHERE family_id = $1 AND care_plan_item_id = $2 AND checkin_date = $3`,
      [scope.familyId, itemId, date],
    );
    const previous = existing.rows[0];
    if (previous === undefined) {
      await client.query(
        `INSERT INTO care_plan_item_checkins
           (id, family_id, patient_profile_id, care_plan_item_id, checkin_date, status, note,
            recorded_by_user_id, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          scope.familyId,
          scope.profileId,
          itemId,
          date,
          input.input.status,
          note,
          input.actor.userId,
          now.toISOString(),
        ],
      );
    } else {
      await client.query(
        `UPDATE care_plan_item_checkins
            SET status = $1, note = $2, recorded_by_user_id = $3, recorded_at = $4
          WHERE family_id = $5 AND id = $6`,
        [
          input.input.status,
          note,
          input.actor.userId,
          now.toISOString(),
          scope.familyId,
          previous.id,
        ],
      );
    }
    await auditCarePlan(client, {
      actor: input.actor,
      scope,
      action: "care_plan.checkin.recorded",
      resourceType: "CarePlanItem",
      resourceId: itemId,
      correlationId: input.correlationId,
      now,
    });
    return {
      created: previous === undefined,
      response: {
        contractVersion: HOME_CARE_PLAN_CONTRACT_VERSION,
        profileId: scope.profileId,
        item: await itemWithCheckins(client, scope, item, now),
      },
    };
  });
}
