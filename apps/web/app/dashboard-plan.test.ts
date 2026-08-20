import assert from "node:assert/strict";
import test from "node:test";
import type { CarePlanCheckin, CarePlanItem } from "@veylta/contracts";
import { buildDashboardPlan } from "./dashboard-plan";

function item(overrides: Partial<CarePlanItem> = {}): CarePlanItem {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    category: "laboratory",
    title: "Повторить ТТГ",
    note: null,
    scheduledFor: "2026-09-15",
    state: "accepted",
    origin: "user",
    revision: 1,
    provenance: null,
    checkins: [],
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
    ...overrides,
  };
}

const mark = (date: string, status: "done" | "skipped"): CarePlanCheckin => ({
  date,
  status,
  note: null,
  recordedAt: `${date}T09:00:00.000Z`,
});

test("an accepted item states its lane, its title and the day it stands on", () => {
  const [row] = buildDashboardPlan([item()], "2026-08-20").scheduled;

  assert.equal(row?.lane, "Анализы");
  assert.equal(row?.title, "Повторить ТТГ");
  assert.equal(row?.when, "15 сентября 2026 г.");
  assert.equal(row?.checkin, null);
});

test("only accepted items reach the overview: a draft is not an action", () => {
  const model = buildDashboardPlan(
    [
      item({ id: "a", state: "proposed" }),
      item({ id: "b", state: "dismissed" }),
      item({ id: "c", state: "completed" }),
      item({ id: "d", state: "accepted" }),
    ],
    "2026-08-20",
  );

  assert.deepEqual(
    model.scheduled.map((row) => row.id),
    ["d"],
  );
  assert.deepEqual(model.today, []);
});

test("the nearest day leads, an undated item comes last, and only three are named", () => {
  const model = buildDashboardPlan(
    [
      item({ id: "late", scheduledFor: "2026-10-01" }),
      item({ id: "none", scheduledFor: null }),
      item({ id: "soon", scheduledFor: "2026-08-21" }),
      item({ id: "middle", scheduledFor: "2026-09-15" }),
    ],
    "2026-08-20",
  );

  assert.deepEqual(
    model.scheduled.map((row) => row.id),
    ["soon", "middle", "late"],
  );
  assert.equal(
    buildDashboardPlan([item({ scheduledFor: null })], "2026-08-20").scheduled[0]?.when,
    "без даты",
  );
});

test("a regimen lane carries today's own mark, and nothing else does", () => {
  const marks = [mark("2026-08-19", "done"), mark("2026-08-20", "skipped")];
  const model = buildDashboardPlan(
    [
      item({ id: "activity", category: "activity", checkins: marks }),
      item({ id: "nutrition", category: "nutrition", checkins: [] }),
      item({ id: "clinician", category: "clinician", checkins: marks }),
    ],
    "2026-08-20",
  );

  assert.deepEqual(
    model.today.map((row) => [row.lane, row.checkin, row.status]),
    [
      ["Активность", "сегодня: пропущено", "skipped"],
      ["Питание", "сегодня: без отметки", null],
    ],
  );
  // The clinician's visit keeps no diary, so it stays a scheduled row with no mark at all.
  assert.deepEqual(
    model.scheduled.map((row) => [row.id, row.checkin]),
    [["clinician", null]],
  );
});

test("«Сегодня» carries one week of the diary, oldest first, today last", () => {
  const [row] = buildDashboardPlan(
    [
      item({
        category: "activity",
        checkins: [mark("2026-08-16", "done"), mark("2026-08-20", "done")],
      }),
    ],
    "2026-08-20",
  ).today;

  assert.equal(row?.week.length, 7);
  assert.equal(row?.week[0]?.date, "2026-08-14");
  assert.equal(row?.week[6]?.date, "2026-08-20");
  assert.equal(row?.week[6]?.today, true);
  assert.equal(row?.week[2]?.status, "done");
  assert.equal(row?.week[3]?.status, null);
  assert.equal(row?.week.filter((cell) => cell.today).length, 1);
});

test("at most three regimen items are named, the rest counted, and none repeated below", () => {
  const regimen = ["a", "b", "c", "d"].map((id) =>
    item({ id, category: "activity", scheduledFor: null }),
  );
  const model = buildDashboardPlan([...regimen, item({ id: "lab" })], "2026-08-20");

  assert.deepEqual(
    model.today.map((row) => row.id),
    ["a", "b", "c"],
  );
  assert.equal(model.todayMore, "ещё 1 в плане");
  assert.deepEqual(
    model.scheduled.map((row) => row.id),
    ["lab", "d"],
  );
  assert.equal(buildDashboardPlan(regimen.slice(0, 3), "2026-08-20").todayMore, null);
});

test("waiting proposals are counted and declined, never attributed to a room", () => {
  const draft = (id: string, category: CarePlanItem["category"]) =>
    item({ id, category, state: "proposed", origin: "codex" });

  assert.equal(buildDashboardPlan([item()], "2026-08-20").proposals, null);
  assert.equal(
    buildDashboardPlan([draft("a", "nutrition")], "2026-08-20").proposals,
    "1 предложение ждёт вашего решения",
  );
  assert.equal(
    buildDashboardPlan([draft("a", "nutrition"), draft("b", "activity")], "2026-08-20").proposals,
    "2 предложения ждут вашего решения",
  );
  assert.equal(
    buildDashboardPlan(
      ["a", "b", "c", "d", "e"].map((id) => draft(id, "activity")),
      "2026-08-20",
    ).proposals,
    "5 предложений ждут вашего решения",
  );
});
