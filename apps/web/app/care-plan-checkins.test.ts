import assert from "node:assert/strict";
import test from "node:test";
import {
  checkinCellTitle,
  checkinGrid,
  checkinSummaryCopy,
  localDateOf,
  takesCheckins,
} from "./care-plan-checkins";

const mark = (date: string, status: "done" | "skipped") => ({
  date,
  status,
  note: null,
  recordedAt: "2026-08-17T10:00:00.000Z",
});

test("the strip is the window ending today, oldest first, with the person's marks placed on it", () => {
  const cells = checkinGrid(
    [mark("2026-08-17", "done"), mark("2026-08-15", "skipped")],
    "2026-08-17",
  );
  assert.equal(cells.length, 28);
  assert.equal(cells[0]?.date, "2026-07-21");
  assert.equal(cells[27]?.date, "2026-08-17");
  assert.equal(cells[27]?.today, true);
  assert.equal(cells[27]?.status, "done");
  assert.equal(cells[25]?.status, "skipped");
  assert.equal(cells[26]?.status, null);
  assert.equal(cells.filter((cell) => cell.today).length, 1);
  // Month boundaries and short windows are just arithmetic on local days.
  assert.deepEqual(
    checkinGrid([], "2026-03-02", 4).map((cell) => cell.date),
    ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"],
  );
});

test("the summary counts marks in words; the tooltip names the day and its mark", () => {
  assert.equal(checkinSummaryCopy([]), "отметок за 4 недели пока нет");
  assert.equal(
    checkinSummaryCopy([
      mark("2026-08-17", "done"),
      mark("2026-08-16", "done"),
      mark("2026-08-15", "skipped"),
    ]),
    "сделано 2 · пропущено 1 за 4 недели",
  );
  assert.equal(
    checkinCellTitle({ date: "2026-08-17", status: "done", today: true }),
    "17.08.2026 — сделано",
  );
  assert.equal(
    checkinCellTitle({ date: "2026-08-16", status: null, today: false }),
    "16.08.2026 — без отметки",
  );
});

test("only the regimen lanes take marks; the local day is the browser's, zero-padded", () => {
  assert.equal(takesCheckins("activity"), true);
  assert.equal(takesCheckins("nutrition"), true);
  assert.equal(takesCheckins("clinician"), false);
  assert.equal(takesCheckins("laboratory"), false);
  assert.equal(localDateOf(new Date(2026, 0, 5, 23, 30)), "2026-01-05");
});
