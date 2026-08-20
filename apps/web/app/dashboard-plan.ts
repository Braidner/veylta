import type { CarePlanItem } from "@veylta/contracts";
import { checkinStatusWord, takesCheckins } from "./care-plan-checkins";
import { carePlanLaneLabel } from "./care-plan-lanes";
import { formatSampleMoment } from "./format-moment";

/** The overview names a few accepted actions; the plan itself is where all of them live. */
export const MAX_DASHBOARD_PLAN_ROWS = 3;

/** One accepted action of the plan as the overview states it: lane, title, day, today's mark. */
export interface DashboardPlanRow {
  readonly id: string;
  readonly lane: string;
  readonly title: string;
  readonly when: string;
  /** «сегодня: сделано» for a regimen lane; null for a lane that keeps no diary. */
  readonly checkin: string | null;
}

/** A dated item comes before an undated one; among dated ones the nearest day leads. */
function byDay(left: CarePlanItem, right: CarePlanItem): number {
  if (left.scheduledFor === null) return right.scheduledFor === null ? 0 : 1;
  if (right.scheduledFor === null) return -1;
  return left.scheduledFor.localeCompare(right.scheduledFor);
}

function checkinOf(item: CarePlanItem, today: string): string | null {
  if (!takesCheckins(item.category)) return null;
  const mark = item.checkins.find((checkin) => checkin.date === today);
  return `сегодня: ${checkinStatusWord(mark?.status ?? null)}`;
}

/**
 * The accepted part of the plan, nearest day first. Proposals are left out: the overview shows
 * what the person has taken on, and a draft becomes an action only through their own decision.
 */
export function dashboardPlanRows(
  items: readonly CarePlanItem[],
  today: string,
  limit = MAX_DASHBOARD_PLAN_ROWS,
): DashboardPlanRow[] {
  return items
    .filter((item) => item.state === "accepted")
    .sort(byDay)
    .slice(0, limit)
    .map((item) => ({
      id: item.id,
      lane: carePlanLaneLabel(item.category),
      title: item.title,
      when: item.scheduledFor === null ? "без даты" : formatSampleMoment(item.scheduledFor),
      checkin: checkinOf(item, today),
    }));
}
