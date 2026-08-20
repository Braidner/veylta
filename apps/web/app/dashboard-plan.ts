import type { CarePlanCheckinStatus, CarePlanItem } from "@veylta/contracts";
import {
  type CheckinCell,
  checkinGrid,
  checkinStatusWord,
  takesCheckins,
} from "./care-plan-checkins";
import { carePlanLaneLabel } from "./care-plan-lanes";
import { formatSampleMoment } from "./format-moment";
import { pluralForm } from "./russian-plural";

/** The overview names a few accepted actions; the plan itself is where all of them live. */
const MAX_PLAN_ROWS = 3;
/** «Сегодня» names as many regimen items as the panel can hold without becoming the plan page. */
const MAX_TODAY_ROWS = 3;
/** The rhythm on the overview is one week of the same diary the plan page draws four weeks of. */
const TODAY_DAYS = 7;

/** One accepted action of the plan as the overview states it: lane, title, day, today's mark. */
export interface DashboardPlanRow {
  readonly id: string;
  readonly lane: string;
  readonly title: string;
  readonly when: string;
  /** «сегодня: сделано» for a regimen lane; null for a lane that keeps no diary. */
  readonly checkin: string | null;
}

/** One accepted regimen item the person marks from the overview itself. */
export interface DashboardTodayRow {
  readonly id: string;
  readonly lane: string;
  readonly title: string;
  /** «сегодня: сделано» — the same phrase every surface prints one day's mark with. */
  readonly checkin: string;
  /** Today's own mark, so the button that matches it reads as chosen. */
  readonly status: CarePlanCheckinStatus | null;
  readonly week: readonly CheckinCell[];
}

export interface DashboardPlanModel {
  readonly today: readonly DashboardTodayRow[];
  /** «ещё 2 в плане» when the regimen runs longer than the overview names; null otherwise. */
  readonly todayMore: string | null;
  readonly scheduled: readonly DashboardPlanRow[];
  /** «2 предложения ждут вашего решения»; null when nothing waits for a decision. */
  readonly proposals: string | null;
}

/** A dated item comes before an undated one; among dated ones the nearest day leads. */
function byDay(left: CarePlanItem, right: CarePlanItem): number {
  if (left.scheduledFor === null) return right.scheduledFor === null ? 0 : 1;
  if (right.scheduledFor === null) return -1;
  return left.scheduledFor.localeCompare(right.scheduledFor);
}

function markOf(item: CarePlanItem, today: string): CarePlanCheckinStatus | null {
  return item.checkins.find((checkin) => checkin.date === today)?.status ?? null;
}

/** The one phrase every overview row prints today's mark with. */
function todayWord(status: CarePlanCheckinStatus | null): string {
  return `сегодня: ${checkinStatusWord(status)}`;
}

function checkinOf(item: CarePlanItem, today: string): string | null {
  if (!takesCheckins(item.category)) return null;
  return todayWord(markOf(item, today));
}

/**
 * The accepted regimen, in the plan's own order — a mark never moves a row under the hand that
 * made it. Only these lanes keep a diary, so only these can be marked from the overview.
 */
function todayRows(
  items: readonly CarePlanItem[],
  today: string,
): { rows: DashboardTodayRow[]; more: number } {
  const regimen = items.filter((item) => item.state === "accepted" && takesCheckins(item.category));
  return {
    rows: regimen.slice(0, MAX_TODAY_ROWS).map((item) => {
      const status = markOf(item, today);
      return {
        id: item.id,
        lane: carePlanLaneLabel(item.category),
        title: item.title,
        checkin: todayWord(status),
        status,
        week: checkinGrid(item.checkins, today, TODAY_DAYS),
      };
    }),
    more: Math.max(regimen.length - MAX_TODAY_ROWS, 0),
  };
}

/**
 * The accepted part of the plan, nearest day first, minus whatever «Сегодня» already names.
 * Proposals are left out: the overview shows what the person has taken on, and a draft becomes an
 * action only through their own decision.
 */
function scheduledRows(
  items: readonly CarePlanItem[],
  today: string,
  named: ReadonlySet<string>,
): DashboardPlanRow[] {
  return items
    .filter((item) => item.state === "accepted" && !named.has(item.id))
    .sort(byDay)
    .slice(0, MAX_PLAN_ROWS)
    .map((item) => ({
      id: item.id,
      lane: carePlanLaneLabel(item.category),
      title: item.title,
      when: item.scheduledFor === null ? "без даты" : formatSampleMoment(item.scheduledFor),
      checkin: checkinOf(item, today),
    }));
}

/**
 * How many drafts wait for a decision — never which assistant wrote them: an item records its lane
 * and that Codex proposed it, not the room, and a lane does not name one.
 */
function proposalsCopy(items: readonly CarePlanItem[]): string | null {
  const count = items.filter((item) => item.state === "proposed").length;
  if (count === 0) return null;
  const noun = pluralForm(count, ["предложение", "предложения", "предложений"]);
  return `${count} ${noun} ${pluralForm(count, ["ждёт", "ждут", "ждут"])} вашего решения`;
}

/** Everything the overview's plan panel states, read once from the plan the person accepted. */
export function buildDashboardPlan(
  items: readonly CarePlanItem[],
  today: string,
): DashboardPlanModel {
  const regimen = todayRows(items, today);
  const named = new Set(regimen.rows.map((row) => row.id));
  return {
    today: regimen.rows,
    todayMore: regimen.more === 0 ? null : `ещё ${regimen.more} в плане`,
    scheduled: scheduledRows(items, today, named),
    proposals: proposalsCopy(items),
  };
}
