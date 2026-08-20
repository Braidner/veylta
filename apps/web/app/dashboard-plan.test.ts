import assert from "node:assert/strict";
import test from "node:test";
import type { CarePlanItem } from "@veylta/contracts";
import { dashboardPlanRows } from "./dashboard-plan";

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

test("an accepted item states its lane, its title and the day it stands on", () => {
  const [row] = dashboardPlanRows([item()], "2026-08-20");

  assert.equal(row?.lane, "Анализы");
  assert.equal(row?.title, "Повторить ТТГ");
  assert.equal(row?.when, "15 сентября 2026 г.");
  assert.equal(row?.checkin, null);
});

test("only accepted items reach the overview: a draft is not an action", () => {
  const rows = dashboardPlanRows(
    [
      item({ id: "a", state: "proposed" }),
      item({ id: "b", state: "dismissed" }),
      item({ id: "c", state: "completed" }),
      item({ id: "d", state: "accepted" }),
    ],
    "2026-08-20",
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ["d"],
  );
});

test("the nearest day leads, an undated item comes last, and only three are named", () => {
  const rows = dashboardPlanRows(
    [
      item({ id: "late", scheduledFor: "2026-10-01" }),
      item({ id: "none", scheduledFor: null }),
      item({ id: "soon", scheduledFor: "2026-08-21" }),
      item({ id: "middle", scheduledFor: "2026-09-15" }),
    ],
    "2026-08-20",
  );

  assert.deepEqual(
    rows.map((row) => row.id),
    ["soon", "middle", "late"],
  );
  assert.equal(
    dashboardPlanRows([item({ scheduledFor: null })], "2026-08-20")[0]?.when,
    "без даты",
  );
});

test("a regimen lane carries today's own mark, and nothing else does", () => {
  const marks = [
    {
      date: "2026-08-19",
      status: "done" as const,
      note: null,
      recordedAt: "2026-08-19T09:00:00.000Z",
    },
    {
      date: "2026-08-20",
      status: "skipped" as const,
      note: null,
      recordedAt: "2026-08-20T09:00:00.000Z",
    },
  ];
  const rows = dashboardPlanRows(
    [
      item({ id: "activity", category: "activity", checkins: marks }),
      item({ id: "nutrition", category: "nutrition", checkins: [] }),
      item({ id: "clinician", category: "clinician", checkins: marks }),
    ],
    "2026-08-20",
  );

  assert.deepEqual(
    rows.map((row) => [row.lane, row.checkin]),
    [
      ["Активность", "сегодня: пропущено"],
      ["Питание", "сегодня: без отметки"],
      ["Специалисты", null],
    ],
  );
});
