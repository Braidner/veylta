import {
  CARE_PLAN_CHECKIN_CATEGORIES,
  CARE_PLAN_CHECKIN_DAYS,
  type CarePlanCategory,
  type CarePlanCheckin,
  type CarePlanCheckinStatus,
} from "@veylta/contracts";

/** The browser's local calendar day in the canonical form the plan stores. */
export function localDateOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Whether a lane's accepted items are a regimen the person marks day by day. */
export function takesCheckins(category: CarePlanCategory): boolean {
  return (CARE_PLAN_CHECKIN_CATEGORIES as readonly string[]).includes(category);
}

export interface CheckinCell {
  readonly date: string;
  readonly status: CarePlanCheckinStatus | null;
  readonly today: boolean;
}

/** The window as a strip of days ending today, oldest first, each with the person's mark if any. */
export function checkinGrid(
  checkins: readonly CarePlanCheckin[],
  today: string,
  days = CARE_PLAN_CHECKIN_DAYS,
): CheckinCell[] {
  const byDate = new Map(checkins.map((mark) => [mark.date, mark.status]));
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  const cells: CheckinCell[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = localDateOf(new Date(year, month - 1, day - offset));
    cells.push({ date, status: byDate.get(date) ?? null, today: offset === 0 });
  }
  return cells;
}

/** «сделано 3 · пропущено 1 за 4 недели», or that there are no marks yet. */
export function checkinSummaryCopy(checkins: readonly CarePlanCheckin[]): string {
  const done = checkins.filter((mark) => mark.status === "done").length;
  const skipped = checkins.filter((mark) => mark.status === "skipped").length;
  if (done + skipped === 0) return "отметок за 4 недели пока нет";
  return `сделано ${done} · пропущено ${skipped} за 4 недели`;
}

/** The mark of one day as the strip's tooltip: «17.08.2026 — сделано». */
export function checkinCellTitle(cell: CheckinCell): string {
  const [year, month, day] = cell.date.split("-");
  const status =
    cell.status === "done" ? "сделано" : cell.status === "skipped" ? "пропущено" : "без отметки";
  return `${day}.${month}.${year} — ${status}`;
}
